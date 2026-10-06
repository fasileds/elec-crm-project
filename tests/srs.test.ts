import bcrypt from "bcryptjs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/actor";
import { prisma } from "@/lib/db";
import { provisionOrganization } from "@/lib/domain/bootstrap";
import { completeOnboarding, createProject, startProjectFromOpportunity, transitionProject } from "@/lib/domain/projects";
import { NFR_CATEGORIES, allQuestions } from "@/lib/domain/srs/catalog";
import { createSrs, listProjectSrs, updateSrsSettings } from "@/lib/domain/srs/core";
import { addCriterion, createItem, generateFromAnswers, saveAnswer, setNfrApplicability, setQaStatus, transitionItem, updateItem, updateSection } from "@/lib/domain/srs/content";
import { addSrsComment, assessChangeRequest, compareVersions, decideChangeRequest, getSrsWorkspace, resolveSrsComment, signSrs, submitChangeRequest, transitionSrs } from "@/lib/domain/srs/workflow";
import { downloadSrs, srsFileName } from "@/lib/domain/srs/artifacts";
import { parseTemplateConfig, saveTemplateVersion } from "@/lib/domain/srs/templates";

async function resetDatabase() {
  const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'");
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  for (const table of tables) await prisma.$executeRawUnsafe(`DELETE FROM "${table.name}"`);
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
}

async function makeActor(roleKey: string, kind: Actor["kind"] = "employee", customerId: string | null = null, name = roleKey) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { slug: "elec" } });
  const role = await prisma.role.findFirstOrThrow({ where: { organizationId: org.id, key: roleKey }, include: { permissions: true } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, customerId, email: `${roleKey}-${Math.random().toString(16).slice(2)}@test.local`, name, passwordHash: await bcrypt.hash("x", 4), kind, status: "active", roles: { create: { roleId: role.id } } },
  });
  const actor: Actor = { userId: user.id, organizationId: org.id, customerId, kind, email: user.email, name, permissions: role.permissions.map((p) => p.permission), sessionId: "s", lastAuthenticatedAt: new Date(), timezone: "UTC", locale: "en-US", currency: "USD" };
  return { org, user, actor };
}

async function setup() {
  const pm = await makeActor("project_manager", "employee", null, "Pat Manager");
  const customer = await prisma.customer.create({ data: { organizationId: pm.org.id, code: "CUS-1", name: "Northwind", searchText: "northwind" } });
  const other = await prisma.customer.create({ data: { organizationId: pm.org.id, code: "CUS-2", name: "Contoso", searchText: "contoso" } });
  const project = await createProject(pm.actor, { customerId: customer.id, name: "Ordering portal", summary: "Replace phone ordering.", projectType: "web_app" });
  const client = await makeActor("customer", "customer", customer.id, "Cleo Client");
  const outsider = await makeActor("customer", "customer", other.id, "Otto Outsider");
  const [doc] = await listProjectSrs(pm.actor, project.id);
  return { pm, customer, project, client, outsider, doc };
}

async function fillToApprovable(actor: Actor, documentId: string) {
  const doc = await prisma.srsDocument.findUniqueOrThrow({ where: { id: documentId }, include: { templateVersion: true } });
  const config = parseTemplateConfig(doc.templateVersion.config);
  for (const question of allQuestions(config).filter((q) => q.required)) {
    const value = question.type === "choice" ? question.options![0] : question.generates ? `${question.key} one: first detail\n${question.key} two: second detail` : `Answer for ${question.key}`;
    const result = await saveAnswer(actor, documentId, { questionKey: question.key, value, expectedVersion: 0, origin: "client_input" });
    expect(result.ok).toBe(true);
  }
  await saveAnswer(actor, documentId, { questionKey: "assumptions", value: "The client provides product data", expectedVersion: 0 });
  await generateFromAnswers(actor, documentId);
  const section = await prisma.srsSection.findUniqueOrThrow({ where: { documentId_key: { documentId, key: "approval_criteria" } } });
  await updateSection(actor, documentId, "approval_criteria", { content: "All must-have requirements have agreed acceptance criteria.", version: section.version });
  const nfr = await createItem(actor, documentId, { kind: "nonfunctional", title: "Fast pages", data: { category: "performance", metric: "p95", target: "800 ms" } });
  await addCriterion(actor, nfr!.id, { given: "normal load", when: "a page loads", then: "it renders within 800 ms" });
  for (const [key] of NFR_CATEGORIES.filter(([key]) => key !== "performance")) {
    const current = await prisma.srsDocument.findUniqueOrThrow({ where: { id: documentId } });
    await setNfrApplicability(actor, documentId, key, { applicable: false, reason: "Covered by hosting standard", version: current.version });
  }
  const frs = await prisma.srsItem.findMany({ where: { documentId, kind: "functional" } });
  for (const fr of frs) await addCriterion(actor, fr.id, { given: "a signed-in buyer", when: "they use the feature", then: "it works" });
  return frs;
}

beforeEach(async () => {
  await resetDatabase();
  await provisionOrganization(prisma, { name: "Elec", slug: "elec", timezone: "UTC" });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("SRS creation", () => {
  it("creates exactly one SRS per converted project and is idempotent", async () => {
    const { pm, project, doc } = await setup();
    expect(doc.code).toMatch(/^ELEC-NOVA-PRJ-\d{4}-SRS$/);
    expect(doc.projectType).toBe("web_app");
    const again = await createSrs(pm.actor, project.id, { mode: "continue" });
    expect(again).toEqual({ id: doc.id, existing: true });
    await expect(createSrs(pm.actor, project.id, { mode: "separate" })).rejects.toMatchObject({ status: 422 });
    const separate = await createSrs(pm.actor, project.id, { mode: "separate", reason: "Separate mobile phase" });
    expect(separate.existing).toBe(false);
    expect(await prisma.srsDocument.count({ where: { projectId: project.id } })).toBe(2);
  });

  it("starts a project from an opportunity once, even when repeated", async () => {
    const { pm, customer } = await setup();
    const opportunity = await prisma.opportunity.create({ data: { organizationId: pm.org.id, code: "OPP-1", name: "Warehouse app", customerId: customer.id, stage: "won", requirements: "Scan stock" } });
    const first = await startProjectFromOpportunity(pm.actor, opportunity.id, { projectType: "mobile" });
    const second = await startProjectFromOpportunity(pm.actor, opportunity.id, { projectType: "mobile" });
    expect(second.id).toBe(first.id);
    expect(await prisma.srsDocument.count({ where: { projectId: first.id } })).toBe(1);
  });
});

describe("SRS visibility and editing", () => {
  it("hides the SRS from clients until access is enabled and never leaks internal notes", async () => {
    const { pm, client, outsider, doc } = await setup();
    await expect(getSrsWorkspace(client.actor, doc.id)).rejects.toMatchObject({ status: 404 });
    await updateSrsSettings(pm.actor, doc.id, { clientAccess: true, version: doc.version });
    await createItem(pm.actor, doc.id, { kind: "functional", title: "Internal pricing note", visibility: "internal" });
    await createItem(pm.actor, doc.id, { kind: "functional", title: "Place an order" });
    await addSrsComment(pm.actor, doc.id, { body: "Margin is thin here", visibility: "internal" });
    const view = await getSrsWorkspace(client.actor, doc.id);
    expect(view.items.map((i) => i.title)).toEqual(["Place an order"]);
    expect(view.comments).toHaveLength(0);
    await expect(getSrsWorkspace(outsider.actor, doc.id)).rejects.toMatchObject({ status: 404 });
    await expect(downloadSrs(client.actor, doc.id, { ref: "latest", format: "pdf" })).rejects.toMatchObject({ status: 404 });
  });

  it("detects concurrent answer edits and rejects secrets", async () => {
    const { pm, client, doc } = await setup();
    await updateSrsSettings(pm.actor, doc.id, { clientAccess: true, version: doc.version });
    const first = await saveAnswer(client.actor, doc.id, { questionKey: "purpose", value: "Sell online", expectedVersion: 0 });
    expect(first.ok).toBe(true);
    const stale = await saveAnswer(pm.actor, doc.id, { questionKey: "purpose", value: "Overwrite", expectedVersion: 0 });
    expect(stale).toMatchObject({ ok: false, conflict: true, current: { value: "Sell online" } });
    const answer = await prisma.srsAnswer.findFirstOrThrow({ where: { documentId: doc.id, questionKey: "purpose" } });
    expect(answer.origin).toBe("client_input");
    await expect(saveAnswer(pm.actor, doc.id, { questionKey: "purpose", value: "api_key = sk_live_abcdefghijklmnop", expectedVersion: 1 })).rejects.toMatchObject({ status: 422 });
    await expect(createItem(pm.actor, doc.id, { kind: "integration", title: "Stripe", data: { authentication: "password: hunter2hunter2" } })).rejects.toMatchObject({ status: 422 });
  });

  it("turns list answers into labelled items without duplicates", async () => {
    const { pm, client, doc } = await setup();
    await updateSrsSettings(pm.actor, doc.id, { clientAccess: true, version: doc.version });
    await saveAnswer(client.actor, doc.id, { questionKey: "features", value: "Browse catalog: search and filter\nCheckout", expectedVersion: 0 });
    expect((await generateFromAnswers(pm.actor, doc.id)).created).toBe(2);
    expect((await generateFromAnswers(pm.actor, doc.id)).created).toBe(0);
    const items = await prisma.srsItem.findMany({ where: { documentId: doc.id, kind: "functional" }, orderBy: { seq: "asc" } });
    expect(items.map((i) => [i.key, i.title, i.origin])).toEqual([["FR-001", "Browse catalog", "client_input"], ["FR-002", "Checkout", "client_input"]]);
  });

  it("threads clarifications and flags the item", async () => {
    const { pm, client, doc } = await setup();
    await updateSrsSettings(pm.actor, doc.id, { clientAccess: true, version: doc.version });
    const item = await createItem(pm.actor, doc.id, { kind: "functional", title: "Refunds" });
    const question = await addSrsComment(pm.actor, doc.id, { body: "Who approves refunds?", kind: "clarification", targetType: "item", targetKey: item!.key });
    expect((await prisma.srsItem.findUniqueOrThrow({ where: { id: item!.id } })).status).toBe("clarification_required");
    await addSrsComment(client.actor, doc.id, { body: "The store manager", parentId: question.id });
    expect((await prisma.srsComment.findUniqueOrThrow({ where: { id: question.id } })).status).toBe("answered");
    await resolveSrsComment(pm.actor, question.id);
    expect((await prisma.srsItem.findUniqueOrThrow({ where: { id: item!.id } })).status).toBe("under_review");
  });
});

describe("SRS edge cases", () => {
  it("keeps existing documents on the template version they were created from", async () => {
    const { project, doc } = await setup();
    const owner = await makeActor("owner", "employee", null, "Olive Owner");
    const before = await prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id }, include: { templateVersion: { include: { template: true } } } });
    const config = parseTemplateConfig(before.templateVersion.config);
    config.styling.footer = "Revised footer";
    const saved = await saveTemplateVersion(owner.actor, before.templateVersion.templateId, { config, note: "Footer", expectedVersion: before.templateVersion.template.currentVersion });
    await expect(saveTemplateVersion(owner.actor, before.templateVersion.templateId, { config, note: "Stale", expectedVersion: before.templateVersion.template.currentVersion })).rejects.toMatchObject({ status: 409 });
    expect((await prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id } })).templateVersionId).toBe(before.templateVersionId);
    const next = await createSrs(owner.actor, project.id, { mode: "separate", reason: "Second product line" });
    const fresh = await prisma.srsDocument.findUniqueOrThrow({ where: { id: next.id }, include: { templateVersion: true } });
    expect(fresh.templateVersion.version).toBe(saved.version);
    await expect(prisma.$executeRawUnsafe(`UPDATE "SrsTemplateVersion" SET "config" = '{}' WHERE "id" = ?`, before.templateVersionId)).rejects.toThrow(/immutable/);
  });

  it("makes archived projects read-only and hides revoked documents from clients", async () => {
    const { pm, client, project, doc } = await setup();
    await updateSrsSettings(pm.actor, doc.id, { clientAccess: true, version: doc.version });
    const current = await prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id } });
    await transitionSrs(pm.actor, doc.id, "internal_review", { version: current.version });
    const review = await prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id } });
    await transitionSrs(pm.actor, doc.id, "client_review", { version: review.version });
    const shared = await prisma.srsVersion.findFirstOrThrow({ where: { documentId: doc.id, clientVisible: true } });
    expect((await downloadSrs(client.actor, doc.id, { ref: shared.id, format: "pdf" })).fileName).toMatch(/REVIEW-COPY\.pdf$/);

    await expect(createItem(client.actor, doc.id, { kind: "functional", title: "Client-invented requirement" })).rejects.toMatchObject({ status: 403 });
    await expect(transitionSrs(client.actor, doc.id, "approval_pending", { version: review.version + 1 })).rejects.toMatchObject({ status: 422 });

    const latest = await prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id } });
    await updateSrsSettings(pm.actor, doc.id, { clientAccess: false, version: latest.version });
    await expect(getSrsWorkspace(client.actor, doc.id)).rejects.toMatchObject({ status: 404 });
    await expect(downloadSrs(client.actor, doc.id, { ref: shared.id, format: "pdf" })).rejects.toMatchObject({ status: 404 });

    await prisma.project.update({ where: { id: project.id }, data: { archivedAt: new Date() } });
    await expect(saveAnswer(pm.actor, doc.id, { questionKey: "purpose", value: "Late edit", expectedVersion: 0 })).rejects.toMatchObject({ status: 409 });
    await expect(createItem(pm.actor, doc.id, { kind: "functional", title: "Late item" })).rejects.toMatchObject({ status: 409 });
    await expect(addSrsComment(pm.actor, doc.id, { body: "Late comment" })).rejects.toMatchObject({ status: 409 });
  }, 30_000);

  it("produces safe download names", () => {
    expect(srsFileName("../../PRJ 0001", "1.0", "pdf", "DRAFT")).toBe("ELEC-NOVA-PRJ-0001-SRS-v1.0-DRAFT.pdf");
    expect(srsFileName("PRJ-0001", "1.0", "pdf", "PENDING APPROVAL")).toBe("ELEC-NOVA-PRJ-0001-SRS-v1.0-PENDING-APPROVAL.pdf");
    expect(srsFileName("PRJ/0001\\x", "2.1", "docx")).not.toMatch(/[\\/]/);
  });
});

describe("SRS approval lifecycle", () => {
  it("blocks approval until complete, locks the approved version, and versions changes", async () => {
    const { pm, client, project, doc } = await setup();
    await updateSrsSettings(pm.actor, doc.id, { clientAccess: true, version: doc.version });
    let current = await prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id } });
    await expect(transitionSrs(pm.actor, doc.id, "internal_review", { version: current.version }).then(() => prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id } })).then((d) => transitionSrs(pm.actor, doc.id, "approval_pending", { version: d.version }))).rejects.toMatchObject({ status: 422 });

    await expect(completeOnboarding(pm.actor, project.id, "approve_scope", "")).rejects.toThrow(/Scope is not approved yet/);
    const frs = await fillToApprovable(pm.actor, doc.id);
    const workspace = await getSrsWorkspace(pm.actor, doc.id);
    expect(workspace.completeness.blockers).toEqual([]);

    current = await prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id } });
    await transitionSrs(pm.actor, doc.id, "client_review", { version: current.version });
    current = await prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id } });
    const { versionId } = await transitionSrs(pm.actor, doc.id, "approval_pending", { version: current.version });
    expect(versionId).toBeTruthy();
    await expect(updateItem(pm.actor, frs[0].id, { title: "Sneaky edit", version: frs[0].version })).rejects.toMatchObject({ status: 409 });
    await expect(prisma.$executeRawUnsafe(`UPDATE "SrsItem" SET "title" = 'Raw edit' WHERE "id" = ?`, frs[0].id)).rejects.toThrow(/locked/);

    await expect(signSrs(client.actor, doc.id, { versionId: versionId!, decision: "approved", typedName: "Someone Else", accept: true })).rejects.toMatchObject({ status: 422 });
    expect((await signSrs(client.actor, doc.id, { versionId: versionId!, decision: "approved", typedName: "cleo client", accept: true, ipAddress: "203.0.113.5" })).outcome).toBe("pending");
    await expect(signSrs(client.actor, doc.id, { versionId: versionId!, decision: "approved", typedName: "Cleo Client", accept: true })).rejects.toMatchObject({ status: 409 });
    expect((await signSrs(pm.actor, doc.id, { versionId: versionId!, decision: "approved", typedName: "Pat Manager", accept: true })).outcome).toBe("approved");

    const approved = await prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(approved).toMatchObject({ status: "approved", major: 1, minor: 0, approvedVersionId: versionId });
    await completeOnboarding(pm.actor, project.id, "approve_scope", "");
    expect(await prisma.onboardingItem.findFirstOrThrow({ where: { projectId: project.id, templateKey: "approve_scope" } })).toMatchObject({ done: true });
    expect(await prisma.srsArtifact.count({ where: { versionId: versionId! } })).toBe(2);
    await expect(prisma.$executeRawUnsafe(`UPDATE "SrsVersion" SET "snapshot" = '{}' WHERE "id" = ?`, versionId)).rejects.toThrow(/immutable/);
    await expect(prisma.$executeRawUnsafe(`UPDATE "SrsSignature" SET "decision" = 'rejected' WHERE "versionId" = ?`, versionId)).rejects.toThrow(/immutable/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "SrsVersion" WHERE "id" = ?`, versionId)).rejects.toThrow(/never deleted/);
    await expect(prisma.$executeRawUnsafe(`UPDATE "SrsVersion" SET "status" = 'draft' WHERE "id" = ?`, versionId)).rejects.toThrow(/superseded/);
    await expect(prisma.$executeRawUnsafe(`UPDATE "SrsSection" SET "content" = 'x' WHERE "documentId" = ?`, doc.id)).rejects.toThrow(/locked/);

    const pdf = await downloadSrs(client.actor, doc.id, { ref: "approved", format: "pdf" });
    expect(pdf.bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.fileName).toMatch(/^ELEC-NOVA-PRJ-\d{4}-SRS-v1\.0\.pdf$/);
    const docx = await downloadSrs(pm.actor, doc.id, { ref: "approved", format: "docx" });
    expect(docx.bytes.subarray(0, 2).toString()).toBe("PK");
    expect(await prisma.auditLog.count({ where: { action: "srs.download" } })).toBe(2);

    const change = await submitChangeRequest(client.actor, doc.id, { title: "Add wish list", reason: "Buyers want to save items", affectedKeys: [frs[0].key] });
    const cr = await prisma.changeRequest.findUniqueOrThrow({ where: { id: change.id } });
    expect(cr.classification).toBe("unclassified");
    await assessChangeRequest(pm.actor, change.id, { classification: "change_request", timelineImpact: "+1 week", effortImpact: "16h", version: cr.version });
    const assessed = await prisma.changeRequest.findUniqueOrThrow({ where: { id: change.id } });
    await decideChangeRequest(pm.actor, change.id, { decision: "approved", note: "Agreed in steering call", version: assessed.version });
    const revised = await prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(revised).toMatchObject({ status: "draft", major: 1, minor: 1 });

    const fr = await prisma.srsItem.findUniqueOrThrow({ where: { id: frs[0].id } });
    expect(fr.reapprovalRequired).toBe(true);
    await expect(updateItem(pm.actor, fr.id, { title: "Browse and save", version: fr.version })).rejects.toMatchObject({ status: 422 });
    await updateItem(pm.actor, fr.id, { title: "Browse and save", version: fr.version, reason: "CR approved" });
    const revisions = await prisma.srsItemRevision.findMany({ where: { itemId: fr.id }, orderBy: { revision: "desc" } });
    expect(revisions[0]).toMatchObject({ requiresReapproval: true, reason: "CR approved" });
    const diff = await compareVersions(pm.actor, doc.id, versionId!, "live");
    expect(diff.entries.some((e) => e.key === fr.key && e.change === "changed")).toBe(true);
    const old = await downloadSrs(client.actor, doc.id, { ref: versionId!, format: "pdf" });
    expect(old.fileName).toMatch(/v1\.0\.pdf$/);
    expect(project.id).toBeTruthy();
  }, 60_000);

  it("records exactly one approval when signers sign at the same time, and refuses inactive signers", async () => {
    const { pm, client, doc } = await setup();
    const second = await makeActor("project_manager", "employee", null, "Sam Second");
    await updateSrsSettings(pm.actor, doc.id, { clientAccess: true, version: doc.version });
    await fillToApprovable(pm.actor, doc.id);
    let current = await prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id } });
    await transitionSrs(pm.actor, doc.id, "internal_review", { version: current.version });
    current = await prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id } });
    const { versionId } = await transitionSrs(pm.actor, doc.id, "approval_pending", { version: current.version });

    await prisma.user.update({ where: { id: second.user.id }, data: { status: "inactive" } });
    await expect(signSrs(second.actor, doc.id, { versionId: versionId!, decision: "approved", typedName: "Sam Second", accept: true })).rejects.toMatchObject({ status: 403 });

    const results = await Promise.allSettled([
      signSrs(client.actor, doc.id, { versionId: versionId!, decision: "approved", typedName: "Cleo Client", accept: true }),
      signSrs(pm.actor, doc.id, { versionId: versionId!, decision: "approved", typedName: "Pat Manager", accept: true }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(results.filter((r) => r.status === "fulfilled" && r.value.outcome === "approved")).toHaveLength(1);
    expect(await prisma.srsVersion.count({ where: { documentId: doc.id, status: "approved" } })).toBe(1);
    expect(await prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ status: "approved", major: 1 });
    expect(await prisma.auditLog.count({ where: { action: "srs.approved", entityId: doc.id } })).toBe(1);
    const notices = await prisma.notification.findMany({ where: { userId: client.user.id, title: { startsWith: "SRS approved" } } });
    expect(notices.length).toBeLessThanOrEqual(1);
  }, 60_000);

  it("enforces the delivery gate on unverified mandatory requirements", async () => {
    const { pm, project, doc } = await setup();
    await prisma.srsDocument.update({ where: { id: doc.id }, data: { approvedVersionId: "v", status: "draft" } });
    const item = await createItem(pm.actor, doc.id, { kind: "functional", title: "Pay by card", priority: "must" });
    await prisma.srsItem.update({ where: { id: item!.id }, data: { baselineVersionId: "v", status: "implemented" } });
    const criterion = await addCriterion(pm.actor, item!.id, { given: "a cart", when: "paying", then: "the card is charged" });
    await prisma.project.update({ where: { id: project.id }, data: { status: "active" } });
    const version = (await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).version;
    await expect(transitionProject(pm.actor, project.id, "completed", version)).rejects.toThrow(/FR-001/);
    await setQaStatus(pm.actor, criterion!.id, { status: "passed", evidence: "Test run 42", version: criterion!.version });
    const fresh = await prisma.srsItem.findUniqueOrThrow({ where: { id: item!.id } });
    await transitionItem(pm.actor, item!.id, "verified", fresh.version);
    await transitionProject(pm.actor, project.id, "completed", version);
  });
});
