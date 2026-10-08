import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/actor";
import { prisma } from "@/lib/db";
import { resetDatabase } from "./reset";
import { provisionOrganization } from "@/lib/domain/bootstrap";
import { assignLeads, commitLeadImport, createLead, getLead, mergeLeads } from "@/lib/domain/leads";
import { createOpportunity, transitionOpportunity } from "@/lib/domain/crm";
import { explainScore } from "@/lib/domain/crm-score";
import { startProjectFromOpportunity } from "@/lib/domain/projects";
import { AppError } from "@/lib/errors";

async function makeActor(roleKey: string, slug: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { slug } });
  const role = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, key: roleKey }, include: { permissions: true } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, email: `${roleKey}-${slug}-${Math.random().toString(16).slice(2)}@test.local`, name: roleKey, passwordHash: await bcrypt.hash("Harbor!2026", 4), kind: "employee", status: "active", emailVerifiedAt: new Date(), roles: { create: { roleId: role.id } } },
  });
  const actor: Actor = { userId: user.id, organizationId: org.id, customerId: null, kind: "employee", email: user.email, name: user.name, permissions: role.permissions.map((item) => item.permission), sessionId: "test", lastAuthenticatedAt: new Date(), timezone: "UTC", locale: "en-US", currency: "USD" };
  return { org, user, actor };
}

beforeEach(async () => {
  await resetDatabase();
  await provisionOrganization(prisma, { name: "Elec", slug: "elec", timezone: "UTC" });
  await provisionOrganization(prisma, { name: "Other", slug: "other", timezone: "UTC" });
});

describe("lead ownership", () => {
  it("records assignment, notifies the employee, and refuses an inactive assignee", async () => {
    const manager = await makeActor("account_manager", "elec");
    const seller = await makeActor("account_manager", "elec");
    const created = await createLead(manager.actor, { name: "Lumen Retail", company: "Lumen", email: "sam@lumen.test", source: "referral" });
    const assigned = await assignLeads(manager.actor, { leadIds: [created.id], userId: seller.user.id, role: "marketing", reason: "Territory match", idempotencyKey: "assign-1" });
    expect(assigned.assigned).toEqual([created.id]);
    const lead = await getLead(seller.actor, created.id);
    expect(lead.marketingOwnerId).toBe(seller.user.id);
    expect(lead.assignments.length).toBeGreaterThan(0);
    const note = await prisma.notification.findFirst({ where: { userId: seller.user.id, type: "lead.assigned" } });
    expect(note?.href).toBe(`/leads/${created.id}`);
    const email = await prisma.emailMessage.findFirst({ where: { userId: seller.user.id, template: "lead_assigned" } });
    expect(email?.toEmail).toBe(seller.user.email);
    const delivered = await waitForEmail(email!.id);
    expect(delivered?.status).toBe("failed");
    expect(delivered?.lastError).toContain("not configured");
    await expect(assignLeads(manager.actor, { leadIds: [created.id], userId: seller.user.id, role: "marketing", reason: "Again" })).rejects.toBeInstanceOf(AppError);
    await prisma.user.update({ where: { id: seller.user.id }, data: { status: "inactive" } });
    await expect(assignLeads(manager.actor, { leadIds: [created.id], userId: seller.user.id, reason: "Retry" })).rejects.toMatchObject({ message: "That employee is inactive and cannot own leads." });
    const still = await prisma.lead.findUniqueOrThrow({ where: { id: created.id } });
    expect(still.ownerId).toBe(seller.user.id);
  });

  it("blocks assignment without permission and hides another organization's lead", async () => {
    const manager = await makeActor("account_manager", "elec");
    const developer = await makeActor("developer", "elec");
    const outsider = await makeActor("owner", "other");
    const created = await createLead(manager.actor, { name: "Private lead", email: "private@elec.test" });
    await expect(assignLeads(developer.actor, { leadIds: [created.id], userId: developer.user.id })).rejects.toBeInstanceOf(AppError);
    await expect(getLead(outsider.actor, created.id)).rejects.toBeInstanceOf(AppError);
  });
});

async function waitForEmail(id: string) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const email = await prisma.emailMessage.findUnique({ where: { id } });
    if (email && email.status !== "queued" && email.status !== "sending") return email;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return prisma.emailMessage.findUnique({ where: { id } });
}

describe("lead records", () => {
  it("keeps assignment history when two leads are merged and skips a duplicate import", async () => {
    const manager = await makeActor("account_manager", "elec");
    const owner = await makeActor("owner", "elec");
    const source = await createLead(manager.actor, { name: "Source Lead", email: "source@merge.test" });
    const target = await createLead(manager.actor, { name: "Target Lead", email: "target@merge.test" });
    await assignLeads(manager.actor, { leadIds: [source.id], userId: manager.user.id, role: "marketing", reason: "Before merge" });
    await mergeLeads(manager.actor, source.id, target.id);
    const archived = await prisma.lead.findUniqueOrThrow({ where: { id: source.id } });
    expect(archived.mergedIntoId).toBe(target.id);
    expect(archived.status).toBe("archived");
    const history = await prisma.leadAssignment.count({ where: { leadId: target.id } });
    expect(history).toBeGreaterThan(0);
    const imported = await commitLeadImport(owner.actor, "name,email,company\nImported Co,imported@co.test,Imported\nImported Co,imported@co.test,Imported\nBad,not-an-email,Nope");
    expect(imported.created).toBe(1);
    expect(imported.skipped).toBe(1);
    expect(imported.failed).toBe(1);
  });

  it("refuses an illegal opportunity stage unless an authorized override is recorded", async () => {
    const manager = await makeActor("account_manager", "elec");
    const customer = await prisma.customer.create({ data: { organizationId: manager.org.id, code: "CUS-9", name: "Pipeline Co", status: "active", searchText: "pipeline co" } });
    const opportunity = await createOpportunity(manager.actor, { customerId: customer.id, name: "Platform deal", valueCents: 250000 });
    await expect(transitionOpportunity(manager.actor, opportunity.id, "won", "")).rejects.toBeInstanceOf(AppError);
    const unchanged = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } });
    expect(unchanged.stage).toBe("qualification");
    const won = await transitionOpportunity(manager.actor, opportunity.id, "won", "Executive exception", true);
    const events = await prisma.opportunityEvent.findMany({ where: { opportunityId: opportunity.id } });
    expect(events.some((event) => event.override && event.toStage === "won")).toBe(true);
    expect(won.project && "created" in won.project && won.project.created).toBe(true);
    const projects = await prisma.project.findMany({ where: { opportunityId: opportunity.id }, include: { srsDocuments: true } });
    expect(projects).toHaveLength(1);
    expect(projects[0]!.srsDocuments).toHaveLength(1);
  });

  it("starts the project once when a deal that already has one is won", async () => {
    const manager = await makeActor("account_manager", "elec");
    const customer = await prisma.customer.create({ data: { organizationId: manager.org.id, code: "CUS-10", name: "Repeat Co", status: "active", searchText: "repeat co" } });
    const opportunity = await createOpportunity(manager.actor, { customerId: customer.id, name: "Repeat deal", valueCents: 90000 });
    const started = await startProjectFromOpportunity(manager.actor, opportunity.id, {});
    const won = await transitionOpportunity(manager.actor, opportunity.id, "won", "Signed", true);
    expect(won.project).toMatchObject({ id: started.id, created: false });
    expect(await prisma.project.count({ where: { opportunityId: opportunity.id } })).toBe(1);
  });
});

describe("lead score", () => {
  it("explains the points that matched", () => {
    const scored = explainScore({ source: "referral", industry: null, email: "a@b.co", phone: null, company: "Acme", estimatedValueCents: 100, priority: "high", activityCount: 0 }, [
      { key: "source_referral", label: "Source is referral", points: 20, enabled: true, kind: "source", match: "referral" },
      { key: "has_phone", label: "Phone number is present", points: 10, enabled: true, kind: "attribute", match: "phone" },
    ]);
    expect(scored.score).toBe(20);
    expect(scored.reasons[0]).toContain("referral");
  });
});
