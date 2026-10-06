import bcrypt from "bcryptjs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/actor";
import { prisma } from "@/lib/db";
import { provisionOrganization } from "@/lib/domain/bootstrap";
import { loginWithPassword, resetPassword } from "@/lib/domain/auth";
import { getProject, createProject } from "@/lib/domain/projects";
import { createTask, transitionTask } from "@/lib/domain/tasks";
import { baselineScope, createRequirement, decideApproval, requestApproval } from "@/lib/domain/requirements";
import { notifyUser, processOutbox } from "@/lib/domain/support";
import { newSecret } from "@/lib/domain/support";
import { AppError } from "@/lib/errors";
import { POST as webhook } from "@/app/api/webhooks/resend/route";
import { createHmac } from "node:crypto";

async function resetDatabase() {
  const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'");
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  for (const table of tables) await prisma.$executeRawUnsafe(`DELETE FROM "${table.name}"`);
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
}

async function makeActor(roleKey: string, slug: string, kind: Actor["kind"] = "employee", customerId: string | null = null) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { slug } });
  const role = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, key: roleKey }, include: { permissions: true } });
  const passwordHash = await bcrypt.hash("Harbor!2026", 4);
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      customerId,
      email: `${roleKey}-${slug}-${Math.random().toString(16).slice(2)}@test.local`,
      name: roleKey,
      passwordHash,
      kind,
      status: "active",
      emailVerifiedAt: new Date(),
      roles: { create: { roleId: role.id } },
    },
  });
  const actor: Actor = {
    userId: user.id,
    organizationId: org.id,
    customerId,
    kind,
    email: user.email,
    name: user.name,
    permissions: role.permissions.map((item) => item.permission),
    sessionId: "test-session",
    lastAuthenticatedAt: new Date(),
    timezone: "UTC",
    locale: "en-US",
    currency: "USD",
  };
  return { org, user, actor };
}

beforeEach(async () => {
  await resetDatabase();
  await provisionOrganization(prisma, { name: "Elec", slug: "elec", timezone: "UTC" });
  await provisionOrganization(prisma, { name: "Other", slug: "other", timezone: "UTC" });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("isolation and delivery rules", () => {
  it("hides another organization's project", async () => {
    const owner = await makeActor("owner", "elec");
    const outsider = await makeActor("owner", "other");
    const customer = await prisma.customer.create({ data: { organizationId: owner.org.id, code: "CUS-1", name: "Acme", searchText: "acme" } });
    const project = await createProject(owner.actor, { customerId: customer.id, name: "Private build" });
    await expect(getProject(outsider.actor, project.id)).rejects.toBeInstanceOf(AppError);
  });

  it("stops a customer from opening another customer's project", async () => {
    const owner = await makeActor("owner", "elec");
    const first = await prisma.customer.create({ data: { organizationId: owner.org.id, code: "CUS-1", name: "One", searchText: "one" } });
    const second = await prisma.customer.create({ data: { organizationId: owner.org.id, code: "CUS-2", name: "Two", searchText: "two" } });
    const project = await createProject(owner.actor, { customerId: first.id, name: "One portal" });
    const customerUser = await makeActor("customer", "elec", "customer", second.id);
    await expect(getProject(customerUser.actor, project.id)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to complete a parent while a child is open unless overridden", async () => {
    const owner = await makeActor("project_manager", "elec");
    const customer = await prisma.customer.create({ data: { organizationId: owner.org.id, code: "CUS-1", name: "Acme", searchText: "acme" } });
    const project = await createProject(owner.actor, { customerId: customer.id, name: "Build" });
    const parent = await createTask(owner.actor, { projectId: project.id, title: "Parent" });
    await createTask(owner.actor, { projectId: project.id, title: "Child", parentId: parent.id });
    let stored = await prisma.task.findUniqueOrThrow({ where: { id: parent.id } });
    await transitionTask(owner.actor, parent.id, "ready", stored.version);
    stored = await prisma.task.findUniqueOrThrow({ where: { id: parent.id } });
    await transitionTask(owner.actor, parent.id, "in_progress", stored.version);
    stored = await prisma.task.findUniqueOrThrow({ where: { id: parent.id } });
    await expect(transitionTask(owner.actor, parent.id, "done", stored.version)).rejects.toMatchObject({ status: 422 });
    const developer = await makeActor("developer", "elec");
    await expect(transitionTask(developer.actor, parent.id, "done", stored.version, "shipping a partial")).rejects.toMatchObject({ status: 422 });
    await transitionTask(owner.actor, parent.id, "done", stored.version, "Customer accepted the remaining child as follow-up");
    const done = await prisma.task.findUniqueOrThrow({ where: { id: parent.id } });
    expect(done.status).toBe("done");
    expect(done.overrideReason).toContain("follow-up");
  });

  it("keeps approved scope intact when a later requirement arrives", async () => {
    const owner = await makeActor("project_manager", "elec");
    const customer = await prisma.customer.create({ data: { organizationId: owner.org.id, code: "CUS-1", name: "Acme", searchText: "acme" } });
    const project = await createProject(owner.actor, { customerId: customer.id, name: "Scoped" });
    const original = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    const requirement = await createRequirement(owner.actor, { projectId: project.id, title: "Initial report", description: "Monthly report", acceptance: "Exports CSV" });
    await prisma.requirement.update({ where: { id: requirement.id }, data: { status: "approved" } });
    await baselineScope(owner.actor, project.id);
    const added = await createRequirement(owner.actor, { projectId: project.id, title: "Extra dashboard", description: "After baseline" });
    const fresh = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(fresh.scope).toBe(original.scope);
    expect(added.changeRequestId).toBeTruthy();
  });

  it("does not decide the same approval twice", async () => {
    const owner = await makeActor("project_manager", "elec");
    const customer = await prisma.customer.create({ data: { organizationId: owner.org.id, code: "CUS-1", name: "Acme", searchText: "acme" } });
    const project = await createProject(owner.actor, { customerId: customer.id, name: "Approvals" });
    const requirement = await createRequirement(owner.actor, { projectId: project.id, title: "Login", description: "Secure login" });
    const approval = await requestApproval(owner.actor, "requirement", requirement.id, project.id);
    await decideApproval(owner.actor, approval.id, "approved", "Looks right");
    await expect(decideApproval(owner.actor, approval.id, "rejected", "Changed my mind")).rejects.toMatchObject({ status: 409 });
  });

  it("deduplicates notifications and keeps email failure outside the business write", async () => {
    const owner = await makeActor("owner", "elec");
    await notifyUser(prisma, { organizationId: owner.org.id, userId: owner.user.id, type: "mention", title: "Hello", body: "Once", href: "/dashboard", dedupeKey: "once" });
    await notifyUser(prisma, { organizationId: owner.org.id, userId: owner.user.id, type: "mention", title: "Hello", body: "Once", href: "/dashboard", dedupeKey: "once", email: { to: owner.user.email, template: "mention", payload: { actor: "Ada", entity: "project", excerpt: "Hi", url: "/dashboard" } } });
    expect(await prisma.notification.count({ where: { userId: owner.user.id } })).toBe(1);
    await processOutbox();
    const email = await prisma.emailMessage.findFirstOrThrow({ where: { userId: owner.user.id } });
    expect(email.status).toBe("failed");
    expect(await prisma.notification.count()).toBe(1);
  });

  it("rejects a disabled account and a reused reset token", async () => {
    const owner = await makeActor("owner", "elec");
    await prisma.user.update({ where: { id: owner.user.id }, data: { status: "inactive", deactivatedAt: new Date() } });
    await expect(loginWithPassword({ email: owner.user.email, password: "Harbor!2026" })).rejects.toMatchObject({ status: 401 });
    await prisma.user.update({ where: { id: owner.user.id }, data: { status: "active", deactivatedAt: null } });
    const secret = newSecret();
    await prisma.passwordResetToken.create({ data: { userId: owner.user.id, tokenHash: secret.hash, expiresAt: new Date(Date.now() + 60_000) } });
    await resetPassword(secret.token, "Different!2026");
    await expect(resetPassword(secret.token, "Another!2026")).rejects.toMatchObject({ status: 409 });
  });

  it("processes a webhook once", async () => {
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from("hook-secret").toString("base64")}`;
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "email_1" } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const digest = createHmac("sha256", Buffer.from("hook-secret")).update(`evt_1.${timestamp}.${body}`).digest("base64");
    const headers = { "svix-id": "evt_1", "svix-timestamp": timestamp, "svix-signature": `v1,${digest}`, "content-type": "application/json" };
    const first = await webhook(new Request("http://localhost/api/webhooks/resend", { method: "POST", headers, body }));
    const second = await webhook(new Request("http://localhost/api/webhooks/resend", { method: "POST", headers, body }));
    expect(first.status).toBe(200);
    expect(await second.json()).toMatchObject({ data: { duplicate: true } });
    expect(await prisma.webhookEvent.count()).toBe(1);
  });

  it("blocks new work on an archived project", async () => {
    const owner = await makeActor("project_manager", "elec");
    const customer = await prisma.customer.create({ data: { organizationId: owner.org.id, code: "CUS-1", name: "Acme", searchText: "acme" } });
    const project = await createProject(owner.actor, { customerId: customer.id, name: "Old" });
    await prisma.project.update({ where: { id: project.id }, data: { status: "archived", archivedAt: new Date(), statusBeforeArchive: "completed" } });
    await expect(createTask(owner.actor, { projectId: project.id, title: "Too late" })).rejects.toMatchObject({ status: 409 });
  });
});
