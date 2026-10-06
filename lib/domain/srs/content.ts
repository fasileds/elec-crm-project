import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { can, requireEmployee, requirePermission } from "@/lib/actor";
import type { Db } from "@/lib/domain/support";
import { writeAudit, writeActivity, scheduleOutbox } from "@/lib/domain/support";
import { conflict, forbidden, notFound, validationError } from "@/lib/errors";
import { cleanText } from "@/lib/text";
import { ITEM_TRANSITIONS, KINDS, NFR_CATEGORIES, ORIGINS, PRIORITIES, QA_STATUSES, allQuestions } from "@/lib/domain/srs/catalog";
import { parseTemplateConfig } from "@/lib/domain/srs/templates";
import { assertCanWrite, assertEditable, assertNoSecrets, canSeeInternal, isLocked, loadSrs, lockedError, nextItemKey, notifySrs } from "@/lib/domain/srs/core";

const REQUIREMENT_KINDS = new Set(["functional", "nonfunctional", "use_case", "user_story", "business_rule", "workflow"]);
const CRITERIA_KINDS = new Set(Object.entries(KINDS).filter(([, meta]) => meta.criteria).map(([kind]) => kind));

export type WorkflowStep = { id: string; type: "step" | "decision"; actor: string; action: string; input: string; output: string; exception: string; yes?: string; no?: string };

async function templateConfig(db: Db, templateVersionId: string) {
  const version = await db.srsTemplateVersion.findUniqueOrThrow({ where: { id: templateVersionId } });
  return parseTemplateConfig(version.config);
}

function itemPermission(kind: string) {
  return REQUIREMENT_KINDS.has(kind) ? ("srs.requirements" as const) : ("srs.edit" as const);
}

export async function saveAnswer(
  actor: Actor,
  documentId: string,
  input: { questionKey: string; value: string; expectedVersion: number; origin?: string },
): Promise<{ ok: true; version: number; updatedAt: string; updatedByName: string } | { ok: false; conflict: true; current: { value: string; version: number; updatedByName: string } }> {
  const { doc, project } = await loadSrs(prisma, actor, documentId);
  assertEditable(doc, project);
  assertCanWrite(actor, doc, "srs.edit");
  const config = await templateConfig(prisma, doc.templateVersionId);
  const question = allQuestions(config).find((q) => q.key === input.questionKey);
  if (!question) throw validationError("That question is not part of this SRS template.");
  const value = cleanText(input.value, 12000);
  assertNoSecrets(value);
  if (question.type === "choice" && value && !question.options?.includes(value)) throw validationError("Choose one of the listed options.");
  const origin = actor.kind === "customer" ? "client_input" : ORIGINS.includes(input.origin as never) ? input.origin! : "elec_proposal";
  try {
    if (input.expectedVersion === 0) {
      const existing = await prisma.srsAnswer.findUnique({ where: { documentId_questionKey: { documentId, questionKey: question.key } } });
      if (existing) return { ok: false, conflict: true, current: { value: existing.value, version: existing.version, updatedByName: existing.updatedByName } };
      const created = await prisma.srsAnswer.create({ data: { documentId, questionKey: question.key, step: question.step, value, origin, updatedById: actor.userId, updatedByName: actor.name } });
      await writeAudit(prisma, actor, { action: "srs.answer", entityType: "srs", entityId: documentId, after: { question: question.key, length: value.length, origin } });
      return { ok: true, version: created.version, updatedAt: created.updatedAt.toISOString(), updatedByName: created.updatedByName };
    }
    const result = await prisma.srsAnswer.updateMany({
      where: { documentId, questionKey: question.key, version: input.expectedVersion },
      data: { value, origin, updatedById: actor.userId, updatedByName: actor.name, version: { increment: 1 } },
    });
    if (result.count !== 1) {
      const current = await prisma.srsAnswer.findUnique({ where: { documentId_questionKey: { documentId, questionKey: question.key } } });
      return { ok: false, conflict: true, current: { value: current?.value ?? "", version: current?.version ?? 0, updatedByName: current?.updatedByName ?? "" } };
    }
    const saved = await prisma.srsAnswer.findUniqueOrThrow({ where: { documentId_questionKey: { documentId, questionKey: question.key } } });
    await writeAudit(prisma, actor, { action: "srs.answer", entityType: "srs", entityId: documentId, after: { question: question.key, length: value.length, origin, version: saved.version } });
    return { ok: true, version: saved.version, updatedAt: saved.updatedAt.toISOString(), updatedByName: saved.updatedByName };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const current = await prisma.srsAnswer.findUnique({ where: { documentId_questionKey: { documentId, questionKey: question.key } } });
      return { ok: false, conflict: true, current: { value: current?.value ?? "", version: current?.version ?? 0, updatedByName: current?.updatedByName ?? "" } };
    }
    lockedError(error);
  }
}

export async function updateSection(
  actor: Actor,
  documentId: string,
  key: string,
  input: { content?: string; applicable?: boolean; naReason?: string; visibility?: string; origin?: string; title?: string; version: number },
) {
  requireEmployee(actor);
  requirePermission(actor, "srs.edit");
  const { doc, project } = await loadSrs(prisma, actor, documentId);
  assertEditable(doc, project);
  const section = await prisma.srsSection.findUnique({ where: { documentId_key: { documentId, key } } });
  if (!section) throw notFound("Section not found.");
  const data: Record<string, unknown> = {};
  if (input.content !== undefined) {
    const content = cleanText(input.content, 20000);
    assertNoSecrets(content);
    data.content = content;
  }
  if (input.title !== undefined) {
    const title = cleanText(input.title, 120);
    if (title.length < 2) throw validationError("Enter a section title.");
    data.title = title;
  }
  if (input.applicable !== undefined) {
    data.applicable = input.applicable;
    const reason = cleanText(input.naReason ?? "", 500);
    if (!input.applicable && reason.length < 5) throw validationError("Explain why this section does not apply.", { naReason: "Give a reason." });
    data.naReason = input.applicable ? "" : reason;
  }
  if (input.visibility !== undefined) {
    if (!["shared", "internal"].includes(input.visibility)) throw validationError("Choose a visibility.");
    if (input.visibility === "internal" && section.required) throw validationError("Required sections are always part of the client document.");
    data.visibility = input.visibility;
  }
  if (input.origin !== undefined) {
    if (!ORIGINS.includes(input.origin as never)) throw validationError("Choose where this content came from.");
    data.origin = input.origin;
  }
  try {
    const result = await prisma.srsSection.updateMany({ where: { id: section.id, version: input.version }, data: { ...data, updatedById: actor.userId, updatedByName: actor.name, version: { increment: 1 } } });
    if (result.count !== 1) throw conflict(`Someone else edited "${section.title}". Reload to see their version.`);
  } catch (error) {
    lockedError(error);
  }
  await writeAudit(prisma, actor, { action: "srs.section.update", entityType: "srs", entityId: documentId, before: { key, version: section.version }, after: { key, fields: Object.keys(data) } });
}

export async function setPrefillOverride(actor: Actor, documentId: string, key: string, text: string | null, version: number) {
  requireEmployee(actor);
  requirePermission(actor, "srs.edit");
  const { doc, project } = await loadSrs(prisma, actor, documentId);
  assertEditable(doc, project);
  const overrides = JSON.parse(doc.overrides || "{}") as Record<string, string>;
  if (text === null || !text.trim()) delete overrides[key];
  else {
    assertNoSecrets(text);
    overrides[key] = cleanText(text, 12000);
  }
  try {
    const result = await prisma.srsDocument.updateMany({ where: { id: documentId, version }, data: { overrides: JSON.stringify(overrides), version: { increment: 1 } } });
    if (result.count !== 1) throw conflict("Someone else updated this SRS. Reload and try again.");
  } catch (error) {
    lockedError(error);
  }
  await writeAudit(prisma, actor, { action: text ? "srs.override.set" : "srs.override.clear", entityType: "srs", entityId: documentId, after: { key } });
}

export async function setNfrApplicability(actor: Actor, documentId: string, category: string, input: { applicable: boolean; reason?: string; version: number }) {
  requireEmployee(actor);
  requirePermission(actor, "srs.requirements");
  if (!NFR_CATEGORIES.some(([key]) => key === category)) throw validationError("Unknown quality category.");
  const { doc, project } = await loadSrs(prisma, actor, documentId);
  assertEditable(doc, project);
  const na = JSON.parse(doc.nfrNotApplicable || "{}") as Record<string, string>;
  if (input.applicable) delete na[category];
  else {
    const reason = cleanText(input.reason ?? "", 500);
    if (reason.length < 5) throw validationError("Explain why this category does not apply.", { reason: "Give a reason." });
    na[category] = reason;
  }
  try {
    const result = await prisma.srsDocument.updateMany({ where: { id: documentId, version: input.version }, data: { nfrNotApplicable: JSON.stringify(na), version: { increment: 1 } } });
    if (result.count !== 1) throw conflict("Someone else updated this SRS. Reload and try again.");
  } catch (error) {
    lockedError(error);
  }
  await writeAudit(prisma, actor, { action: "srs.nfr.applicability", entityType: "srs", entityId: documentId, after: { category, applicable: input.applicable, reason: input.reason } });
}

function cleanData(kind: string, raw: Record<string, unknown>) {
  const meta = KINDS[kind];
  const data: Record<string, unknown> = {};
  for (const field of meta.fields) {
    const value = raw[field.key];
    if (value == null || value === "") continue;
    const text = cleanText(String(value), 8000);
    if (field.type === "select" && field.options && !field.options.some(([key]) => key === text)) throw validationError(`Choose a valid ${field.label.toLowerCase()}.`);
    if (field.type === "url" && text && !/^https:\/\/[^\s]+$/i.test(text)) throw validationError(`${field.label} must be an https:// link.`);
    data[field.key] = text;
  }
  if (kind === "workflow" && Array.isArray(raw.steps)) {
    data.steps = (raw.steps as Array<Record<string, unknown>>).slice(0, 60).map((step, index) => ({
      id: String(index + 1),
      type: step.type === "decision" ? "decision" : "step",
      actor: cleanText(String(step.actor ?? ""), 120),
      action: cleanText(String(step.action ?? ""), 500),
      input: cleanText(String(step.input ?? ""), 300),
      output: cleanText(String(step.output ?? ""), 300),
      exception: cleanText(String(step.exception ?? ""), 300),
      yes: cleanText(String(step.yes ?? ""), 20),
      no: cleanText(String(step.no ?? ""), 20),
    })).filter((step) => step.action);
  }
  assertNoSecrets(...Object.values(data).flatMap((value) => (typeof value === "string" ? [value] : JSON.stringify(value))));
  return data;
}

function snapshotOf(item: { key: string; kind: string; title: string; description: string; data: string; origin: string; status: string; priority: string; visibility: string; ownerName: string }) {
  return JSON.stringify({ key: item.key, kind: item.kind, title: item.title, description: item.description, data: JSON.parse(item.data || "{}"), origin: item.origin, status: item.status, priority: item.priority, visibility: item.visibility, owner: item.ownerName });
}

type ItemInput = { kind: string; title: string; description?: string; priority?: string; origin?: string; visibility?: string; ownerId?: string | null; data?: Record<string, unknown>; sourceKey?: string };

async function insertItem(db: Db, actor: Actor, doc: { id: string; organizationId: string }, input: ItemInput) {
  const meta = KINDS[input.kind];
  if (!meta) throw validationError("Unknown item type.");
  const title = cleanText(input.title, 240);
  if (title.length < 2) throw validationError("Enter a title.", { title: "Enter a title." });
  const description = cleanText(input.description ?? "", 12000);
  assertNoSecrets(title, description);
  const priority = PRIORITIES.includes(input.priority as never) ? input.priority! : "should";
  const origin = ORIGINS.includes(input.origin as never) ? input.origin! : "elec_proposal";
  const visibility = input.visibility === "internal" ? "internal" : "shared";
  const data = cleanData(input.kind, input.data ?? {});
  let ownerName = "";
  if (input.ownerId) {
    const owner = await db.user.findFirst({ where: { id: input.ownerId, organizationId: actor.organizationId, kind: "employee", status: "active" } });
    if (!owner) throw validationError("Choose an active team member as owner.");
    ownerName = owner.name;
  }
  const { key, seq } = await nextItemKey(db, doc.organizationId, doc.id, meta.prefix);
  const item = await db.srsItem.create({
    data: {
      organizationId: doc.organizationId,
      documentId: doc.id,
      kind: input.kind,
      key,
      seq,
      sort: seq,
      title,
      description,
      data: JSON.stringify(data),
      origin,
      priority,
      visibility,
      ownerId: input.ownerId || null,
      ownerName,
      sourceKey: input.sourceKey,
      createdById: actor.userId,
      createdByName: actor.name,
    },
  });
  await db.srsItemRevision.create({ data: { itemId: item.id, revision: 1, snapshot: snapshotOf(item), changeSummary: "Created", actorId: actor.userId, actorName: actor.name } });
  return item;
}

export async function createItem(actor: Actor, documentId: string, input: ItemInput) {
  requireEmployee(actor);
  const { doc, project } = await loadSrs(prisma, actor, documentId);
  assertEditable(doc, project);
  requirePermission(actor, itemPermission(input.kind));
  if (input.visibility === "internal") requirePermission(actor, "srs.internal");
  try {
    const item = await prisma.$transaction(async (tx) => {
      const created = await insertItem(tx, actor, doc, input);
      await writeAudit(tx, actor, { action: "srs.item.create", entityType: "srs_item", entityId: created.id, after: { key: created.key, kind: created.kind, title: created.title, origin: created.origin } });
      return created;
    });
    return { id: item.id, key: item.key };
  } catch (error) {
    lockedError(error);
  }
}

export async function loadItem(actor: Actor, itemId: string) {
  const item = await prisma.srsItem.findFirst({ where: { id: itemId, organizationId: actor.organizationId } });
  if (!item) throw notFound("Item not found.");
  const { doc, project } = await loadSrs(prisma, actor, item.documentId);
  if (item.visibility === "internal" && !canSeeInternal(actor)) throw notFound("Item not found.");
  return { item, doc, project };
}

export async function updateItem(
  actor: Actor,
  itemId: string,
  input: { title?: string; description?: string; priority?: string; origin?: string; visibility?: string; ownerId?: string | null; data?: Record<string, unknown>; version: number; reason?: string },
) {
  requireEmployee(actor);
  const { item, doc, project } = await loadItem(actor, itemId);
  assertEditable(doc, project);
  requirePermission(actor, itemPermission(item.kind));
  const next: Record<string, unknown> = {};
  const changed: string[] = [];
  if (input.title !== undefined && cleanText(input.title, 240) !== item.title) {
    const title = cleanText(input.title, 240);
    if (title.length < 2) throw validationError("Enter a title.", { title: "Enter a title." });
    next.title = title;
    changed.push("title");
  }
  if (input.description !== undefined && cleanText(input.description, 12000) !== item.description) {
    next.description = cleanText(input.description, 12000);
    changed.push("description");
  }
  if (input.priority !== undefined && input.priority !== item.priority) {
    if (!PRIORITIES.includes(input.priority as never)) throw validationError("Choose a priority.");
    next.priority = input.priority;
    changed.push("priority");
  }
  if (input.origin !== undefined && input.origin !== item.origin) {
    if (!ORIGINS.includes(input.origin as never)) throw validationError("Choose where this came from.");
    next.origin = input.origin;
    changed.push("origin");
  }
  if (input.visibility !== undefined && input.visibility !== item.visibility) {
    requirePermission(actor, "srs.internal");
    if (item.approvedAt && input.visibility === "internal") throw validationError("Approved items stay in the client document. Deprecate it instead.");
    next.visibility = input.visibility === "internal" ? "internal" : "shared";
    changed.push("visibility");
  }
  if (input.ownerId !== undefined && (input.ownerId || null) !== item.ownerId) {
    if (input.ownerId) {
      const owner = await prisma.user.findFirst({ where: { id: input.ownerId, organizationId: actor.organizationId, kind: "employee", status: "active" } });
      if (!owner) throw validationError("Choose an active team member as owner.");
      next.ownerName = owner.name;
    } else next.ownerName = "";
    next.ownerId = input.ownerId || null;
    changed.push("owner");
  }
  if (input.data !== undefined) {
    const data = cleanData(item.kind, input.data);
    if (JSON.stringify(data) !== JSON.stringify(JSON.parse(item.data || "{}"))) {
      next.data = JSON.stringify(data);
      changed.push("details");
    }
  }
  assertNoSecrets(next.title as string, next.description as string);
  if (!changed.length) return { id: item.id, changed: [] };
  const reason = cleanText(input.reason ?? "", 1000);
  const baselined = Boolean(item.approvedAt);
  if (baselined && reason.length < 5) throw validationError("This item was approved. Explain why it is changing.", { reason: "Give a reason for the change." });
  if (baselined) {
    next.reapprovalRequired = true;
    if (["approved", "implemented", "verified"].includes(item.status)) next.status = "under_review";
  }
  try {
    await prisma.$transaction(async (tx) => {
      const result = await tx.srsItem.updateMany({ where: { id: item.id, version: input.version }, data: { ...next, version: { increment: 1 } } });
      if (result.count !== 1) throw conflict(`Someone else edited ${item.key}. Reload to see their changes.`);
      const saved = await tx.srsItem.findUniqueOrThrow({ where: { id: item.id } });
      const last = await tx.srsItemRevision.findFirst({ where: { itemId: item.id }, orderBy: { revision: "desc" } });
      await tx.srsItemRevision.create({
        data: { itemId: item.id, revision: (last?.revision ?? 0) + 1, snapshot: snapshotOf(saved), changeSummary: `Changed ${changed.join(", ")}`, reason, requiresReapproval: baselined, actorId: actor.userId, actorName: actor.name },
      });
      await writeAudit(tx, actor, { action: "srs.item.update", entityType: "srs_item", entityId: item.id, before: JSON.parse(snapshotOf(item)), after: { changed, reason, reapprovalRequired: baselined } });
    });
  } catch (error) {
    lockedError(error);
  }
  if (baselined) {
    await notifySrs(prisma, actor, doc, project, { audience: "team", event: "reapproval", title: `${item.key} needs re-approval`, body: `${actor.name} changed an approved item: ${reason}`, tab: "requirements", dedupe: `reapproval:${item.id}:${input.version}` });
    scheduleOutbox();
  }
  return { id: item.id, changed };
}

const LOCKED_ITEM_FLOW = new Set(["approved", "implemented", "verified"]);

export async function transitionItem(actor: Actor, itemId: string, status: string, version: number, note = "") {
  requireEmployee(actor);
  const { item, doc, project } = await loadItem(actor, itemId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  if (!(ITEM_TRANSITIONS[item.status] ?? []).includes(status)) throw validationError(`Cannot move ${item.key} from ${item.status.replaceAll("_", " ")} to ${status.replaceAll("_", " ")}.`);
  if (isLocked(doc.status) && !(LOCKED_ITEM_FLOW.has(item.status) && LOCKED_ITEM_FLOW.has(status))) {
    throw conflict("This SRS is locked. Only implementation and verification status can change until a revision is started.");
  }
  if (status === "approved" || status === "rejected") requirePermission(actor, "srs.approve_requirements");
  else if (status === "verified") requirePermission(actor, "srs.verify");
  else if (status === "clarification_required") requirePermission(actor, "srs.clarify");
  else requirePermission(actor, itemPermission(item.kind));
  if (status === "verified" && CRITERIA_KINDS.has(item.kind)) {
    const criteria = await prisma.srsCriterion.findMany({ where: { itemId } });
    if (!criteria.length) throw validationError(`${item.key} has no acceptance criteria to verify against.`);
    const open = criteria.filter((c) => !["passed", "na"].includes(c.qaStatus));
    if (open.length) throw validationError(`${open.length} acceptance criteria for ${item.key} have not passed yet.`);
  }
  if (status === "approved" && CRITERIA_KINDS.has(item.kind) && item.kind === "functional") {
    const count = await prisma.srsCriterion.count({ where: { itemId } });
    if (!count) throw validationError(`Add acceptance criteria to ${item.key} before approving it.`);
  }
  const data: Record<string, unknown> = { status, version: { increment: 1 } };
  if (status === "approved") Object.assign(data, { approvedAt: new Date(), approvedByName: actor.name, reapprovalRequired: false });
  await prisma.$transaction(async (tx) => {
    const result = await tx.srsItem.updateMany({ where: { id: itemId, version }, data });
    if (result.count !== 1) throw conflict(`Someone else updated ${item.key}. Reload and try again.`);
    const saved = await tx.srsItem.findUniqueOrThrow({ where: { id: itemId } });
    const last = await tx.srsItemRevision.findFirst({ where: { itemId }, orderBy: { revision: "desc" } });
    await tx.srsItemRevision.create({ data: { itemId, revision: (last?.revision ?? 0) + 1, snapshot: snapshotOf(saved), changeSummary: `Status ${item.status.replaceAll("_", " ")} → ${status.replaceAll("_", " ")}`, reason: cleanText(note, 1000), actorId: actor.userId, actorName: actor.name } });
    await writeAudit(tx, actor, { action: "srs.item.transition", entityType: "srs_item", entityId: itemId, before: { status: item.status }, after: { status, note } });
  });
  return { id: itemId, status };
}

export async function deleteItem(actor: Actor, itemId: string) {
  requireEmployee(actor);
  const { item, doc, project } = await loadItem(actor, itemId);
  assertEditable(doc, project);
  requirePermission(actor, itemPermission(item.kind));
  if (item.approvedAt || item.baselineVersionId) throw conflict(`${item.key} is part of an approved baseline. Deprecate it instead of deleting it.`);
  const links = await prisma.srsLink.count({ where: { itemId } });
  if (links) throw conflict(`${item.key} is linked to delivery work. Deprecate it instead.`);
  try {
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, actor, { action: "srs.item.delete", entityType: "srs_item", entityId: itemId, before: JSON.parse(snapshotOf(item)) });
      await tx.srsItem.delete({ where: { id: itemId } });
    });
  } catch (error) {
    lockedError(error);
  }
}

export async function addCriterion(actor: Actor, itemId: string, input: { given: string; when: string; then: string }) {
  requireEmployee(actor);
  const { item, doc, project } = await loadItem(actor, itemId);
  assertEditable(doc, project);
  requirePermission(actor, "srs.requirements");
  if (!CRITERIA_KINDS.has(item.kind)) throw validationError("This item type does not take acceptance criteria.");
  const given = cleanText(input.given, 1000);
  const whenText = cleanText(input.when, 1000);
  const thenText = cleanText(input.then, 1000);
  if (!given || !whenText || !thenText) throw validationError("Fill in Given, When and Then.");
  assertNoSecrets(given, whenText, thenText);
  const count = await prisma.srsCriterion.count({ where: { itemId } });
  try {
    const criterion = await prisma.srsCriterion.create({ data: { itemId, given, whenText, thenText, sort: count + 1 } });
    if (item.approvedAt) await prisma.srsItem.update({ where: { id: itemId }, data: { reapprovalRequired: true } });
    await writeAudit(prisma, actor, { action: "srs.criterion.create", entityType: "srs_item", entityId: itemId, after: { criterionId: criterion.id, given, when: whenText, then: thenText } });
    return criterion;
  } catch (error) {
    lockedError(error);
  }
}

export async function removeCriterion(actor: Actor, criterionId: string) {
  requireEmployee(actor);
  const criterion = await prisma.srsCriterion.findUnique({ where: { id: criterionId } });
  if (!criterion) throw notFound("Criterion not found.");
  const { item, doc, project } = await loadItem(actor, criterion.itemId);
  assertEditable(doc, project);
  requirePermission(actor, "srs.requirements");
  try {
    await prisma.srsCriterion.delete({ where: { id: criterionId } });
  } catch (error) {
    lockedError(error);
  }
  if (item.approvedAt) await prisma.srsItem.update({ where: { id: item.id }, data: { reapprovalRequired: true } });
  await writeAudit(prisma, actor, { action: "srs.criterion.delete", entityType: "srs_item", entityId: item.id, before: { given: criterion.given, when: criterion.whenText, then: criterion.thenText } });
}

export async function setQaStatus(actor: Actor, criterionId: string, input: { status: string; evidence?: string; version: number }) {
  requireEmployee(actor);
  requirePermission(actor, "srs.verify");
  if (!QA_STATUSES.includes(input.status as never)) throw validationError("Choose a QA status.");
  const criterion = await prisma.srsCriterion.findUnique({ where: { id: criterionId } });
  if (!criterion) throw notFound("Criterion not found.");
  const { item, project } = await loadItem(actor, criterion.itemId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  const evidence = cleanText(input.evidence ?? "", 2000);
  assertNoSecrets(evidence);
  if (input.status === "na" && evidence.length < 5) throw validationError("Explain why this criterion is not applicable.", { evidence: "Give a reason." });
  const result = await prisma.srsCriterion.updateMany({
    where: { id: criterionId, version: input.version },
    data: { qaStatus: input.status, evidence, verifiedByName: actor.name, verifiedAt: new Date(), version: { increment: 1 } },
  });
  if (result.count !== 1) throw conflict("Someone else updated this test result. Reload and try again.");
  if (input.status === "failed" && item.status === "verified") await prisma.srsItem.update({ where: { id: item.id }, data: { status: "implemented", version: { increment: 1 } } });
  await writeAudit(prisma, actor, { action: "srs.qa", entityType: "srs_item", entityId: item.id, before: { qaStatus: criterion.qaStatus }, after: { criterionId, qaStatus: input.status, evidence } });
}

function parseLine(line: string) {
  const cleaned = line.replace(/^\s*([-*•]|\d+[.)])\s*/, "").trim();
  const match = cleaned.match(/^(.{2,160}?)\s*[:—–]\s+(.+)$/) ?? cleaned.match(/^(.{2,160}?)\s+-\s+(.+)$/);
  return match ? { title: match[1].trim(), description: match[2].trim() } : { title: cleaned.slice(0, 240), description: cleaned.length > 240 ? cleaned : "" };
}

export async function generateFromAnswers(actor: Actor, documentId: string) {
  requireEmployee(actor);
  requirePermission(actor, "srs.requirements");
  const { doc, project } = await loadSrs(prisma, actor, documentId);
  assertEditable(doc, project);
  const config = await templateConfig(prisma, doc.templateVersionId);
  const answers = await prisma.srsAnswer.findMany({ where: { documentId } });
  let created = 0;
  try {
    await prisma.$transaction(async (tx) => {
      for (const question of allQuestions(config)) {
        if (!question.generates) continue;
        const answer = answers.find((a) => a.questionKey === question.key);
        if (!answer?.value.trim()) continue;
        for (const line of answer.value.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 1)) {
          const sourceKey = `${question.key}:${createHash("sha256").update(line.toLowerCase()).digest("hex").slice(0, 16)}`;
          const exists = await tx.srsItem.findUnique({ where: { documentId_sourceKey: { documentId, sourceKey } } });
          if (exists) continue;
          const parsed = parseLine(line);
          await insertItem(tx, actor, doc, { kind: question.generates, ...parsed, origin: answer.origin === "client_input" ? "client_input" : answer.origin, sourceKey });
          created += 1;
        }
      }
      await writeAudit(tx, actor, { action: "srs.generate", entityType: "srs", entityId: documentId, after: { created } });
    });
  } catch (error) {
    lockedError(error);
  }
  if (created) await writeActivity(prisma, actor, { type: "srs.generated", summary: `Structured ${created} SRS items from wizard answers`, projectId: project.id, entityType: "srs", entityId: documentId });
  return { created };
}

export async function linkItem(actor: Actor, itemId: string, input: { targetType: string; targetId: string }) {
  requireEmployee(actor);
  requirePermission(actor, "srs.requirements");
  const { item, project } = await loadItem(actor, itemId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  let label = "";
  if (input.targetType === "task") {
    const task = await prisma.task.findFirst({ where: { id: input.targetId, projectId: project.id } });
    if (!task) throw validationError("Choose a task on this project.");
    label = `${task.code} ${task.title}`;
  } else if (input.targetType === "milestone") {
    const milestone = await prisma.milestone.findFirst({ where: { id: input.targetId, projectId: project.id } });
    if (!milestone) throw validationError("Choose a milestone on this project.");
    label = `${milestone.code} ${milestone.name}`;
  } else if (input.targetType === "item") {
    const other = await prisma.srsItem.findFirst({ where: { id: input.targetId, documentId: item.documentId } });
    if (!other || other.id === item.id) throw validationError("Choose another item in this SRS.");
    label = `${other.key} ${other.title}`;
  } else throw forbidden("Unsupported link.");
  await prisma.srsLink.upsert({
    where: { itemId_targetType_targetId: { itemId, targetType: input.targetType, targetId: input.targetId } },
    create: { itemId, targetType: input.targetType, targetId: input.targetId, label, createdByName: actor.name },
    update: {},
  });
  await writeAudit(prisma, actor, { action: "srs.link", entityType: "srs_item", entityId: itemId, after: input });
}

export async function convertItem(actor: Actor, itemId: string, target: "task" | "milestone") {
  requireEmployee(actor);
  const { item, project } = await loadItem(actor, itemId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  if (!["functional", "nonfunctional", "user_story", "deliverable"].includes(item.kind)) throw validationError("Only requirements, stories and deliverables convert into delivery work.");
  const existing = await prisma.srsLink.findFirst({ where: { itemId, targetType: target } });
  if (existing) return { id: existing.targetId, existing: true };
  if (target === "task") {
    requirePermission(actor, "tasks.create");
    const { createTask } = await import("@/lib/domain/tasks");
    const priority = item.priority === "must" ? "high" : item.priority === "could" ? "low" : "medium";
    const task = await createTask(actor, { projectId: project.id, title: `${item.key} ${item.title}`.slice(0, 180), description: `${item.description}\n\nFrom SRS requirement ${item.key}.`.trim(), priority });
    await linkItem(actor, itemId, { targetType: "task", targetId: task.id });
    return { id: task.id, existing: false };
  }
  requirePermission(actor, "projects.edit");
  const { createMilestone } = await import("@/lib/domain/projects");
  const milestone = await createMilestone(actor, project.id, { name: `${item.key} ${item.title}`.slice(0, 180), description: item.description, dueOn: (JSON.parse(item.data || "{}") as { dueOn?: string }).dueOn?.match(/^\d{4}-\d{2}-\d{2}$/) ? (JSON.parse(item.data) as { dueOn: string }).dueOn : undefined });
  await linkItem(actor, itemId, { targetType: "milestone", targetId: milestone.id });
  return { id: milestone.id, existing: false };
}

export function canEditRequirements(actor: Actor) {
  return actor.kind === "employee" && can(actor, "srs.requirements");
}
