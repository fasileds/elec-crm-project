import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { can, requireEmployee, requirePermission } from "@/lib/actor";
import type { Permission } from "@/lib/permissions";
import type { Db } from "@/lib/domain/support";
import { nextCode, notifyUser, scheduleOutbox, writeActivity, writeAudit } from "@/lib/domain/support";
import { conflict, forbidden, notFound, validationError } from "@/lib/errors";
import { log } from "@/lib/log";
import { cleanText } from "@/lib/text";
import { SRS_STATUS_LABELS, type SrsStatus } from "@/lib/domain/srs/catalog";
import { assertNoSecrets, canSeeInternal, isLocked, loadSrs, notifySrs, srsHref, versionLabel, visibilityWhere } from "@/lib/domain/srs/core";
import { buildDocModel, completeness, hashModel, loadDocInputs, type DocModel, type DocSigner } from "@/lib/domain/srs/model";

type Rule = { to: string; permission: Permission; client?: boolean };

const DOC_TRANSITIONS: Record<string, Rule[]> = {
  draft: [
    { to: "client_input_required", permission: "srs.edit" },
    { to: "internal_review", permission: "srs.edit" },
    { to: "archived", permission: "srs.admin" },
  ],
  client_input_required: [
    { to: "draft", permission: "srs.edit" },
    { to: "internal_review", permission: "srs.edit" },
    { to: "internal_review", permission: "srs.respond", client: true },
  ],
  internal_review: [
    { to: "draft", permission: "srs.edit" },
    { to: "changes_requested", permission: "srs.edit" },
    { to: "client_review", permission: "srs.publish" },
    { to: "approval_pending", permission: "srs.approve" },
  ],
  client_review: [
    { to: "changes_requested", permission: "srs.edit" },
    { to: "changes_requested", permission: "srs.respond", client: true },
    { to: "internal_review", permission: "srs.edit" },
    { to: "approval_pending", permission: "srs.approve" },
  ],
  changes_requested: [
    { to: "draft", permission: "srs.edit" },
    { to: "internal_review", permission: "srs.edit" },
  ],
  approval_pending: [{ to: "changes_requested", permission: "srs.approve" }],
  approved: [
    { to: "superseded", permission: "srs.admin" },
    { to: "archived", permission: "srs.admin" },
  ],
  superseded: [{ to: "archived", permission: "srs.admin" }],
  archived: [],
};

export function allowedTransitions(actor: Actor, status: string) {
  return (DOC_TRANSITIONS[status] ?? []).filter((rule) => (actor.kind === "customer") === Boolean(rule.client) && can(actor, rule.permission)).map((rule) => rule.to);
}

async function snapshot(
  db: Db,
  actor: Actor,
  documentId: string,
  input: { kind: "review" | "candidate"; status: string; label: string; clientVisible: boolean; note: string; changeRequestId?: string | null },
) {
  const inputs = await loadDocInputs(db, documentId);
  const model = buildDocModel(inputs, { versionLabel: input.label, status: input.status === "in_approval" ? "approval_pending" : input.kind === "review" ? "client_review" : inputs.doc.status });
  const last = await db.srsVersion.findFirst({ where: { documentId }, orderBy: { seq: "desc" } });
  return db.srsVersion.create({
    data: {
      documentId,
      seq: (last?.seq ?? 0) + 1,
      label: input.label,
      kind: input.kind,
      status: input.status,
      snapshot: JSON.stringify(model),
      hash: hashModel(model),
      note: cleanText(input.note, 1000),
      clientVisible: input.clientVisible,
      publishedAt: input.clientVisible ? new Date() : null,
      changeRequestId: input.changeRequestId ?? null,
      createdById: actor.userId,
      createdByName: actor.name,
    },
  });
}

export async function transitionSrs(actor: Actor, documentId: string, to: string, input: { version: number; note?: string }) {
  const { doc, project } = await loadSrs(prisma, actor, documentId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  const rule = (DOC_TRANSITIONS[doc.status] ?? []).find((r) => r.to === to && (actor.kind === "customer") === Boolean(r.client));
  if (!rule) throw validationError(`Cannot move this SRS from ${SRS_STATUS_LABELS[doc.status as SrsStatus] ?? doc.status} to ${SRS_STATUS_LABELS[to as SrsStatus] ?? to}.`);
  requirePermission(actor, rule.permission);
  const note = cleanText(input.note ?? "", 1000);
  assertNoSecrets(note);
  if (to === "changes_requested" && note.length < 5) throw validationError("Describe the changes you need.", { note: "Describe the changes." });
  if (to === "client_review" && !doc.clientAccess) throw validationError("Turn on client access before sending the SRS for client review.");
  const config = (await loadDocInputs(prisma, documentId)).config;
  if (to === "approval_pending") {
    const check = completeness(await loadDocInputs(prisma, documentId));
    if (check.blockers.length) throw validationError(`Resolve ${check.blockers.length} blocker${check.blockers.length === 1 ? "" : "s"} before requesting approval: ${check.blockers.slice(0, 3).map((b) => b.message).join(" ")}`);
    if (config.approval.clientSigners > 0 && !doc.clientAccess) throw validationError("This template needs client signatures. Turn on client access first.");
    const open = await prisma.srsComment.count({ where: { documentId, kind: "clarification", status: { in: ["open", "answered"] }, parentId: null } });
    if (open) throw validationError(`Resolve ${open} open clarification${open === 1 ? "" : "s"} before requesting approval.`);
  }
  const result = await prisma.$transaction(async (tx) => {
    let versionId: string | null = null;
    if (to === "client_review") {
      const created = await snapshot(tx, actor, documentId, { kind: "review", status: "published", label: versionLabel(doc), clientVisible: true, note: note || "Shared for client review" });
      versionId = created.id;
    }
    if (to === "approval_pending") {
      const created = await snapshot(tx, actor, documentId, { kind: "candidate", status: "in_approval", label: `${doc.major + 1}.0`, clientVisible: doc.clientAccess, note: note || "Submitted for approval" });
      versionId = created.id;
    }
    if (doc.status === "approval_pending" && to === "changes_requested") {
      await tx.srsVersion.updateMany({ where: { documentId, status: "in_approval" }, data: { status: "withdrawn" } });
    }
    const data: Record<string, unknown> = { status: to, version: { increment: 1 } };
    if (to === "client_review") data.minor = doc.minor + 1;
    if (to === "archived") data.archivedAt = new Date();
    const updated = await tx.srsDocument.updateMany({ where: { id: documentId, version: input.version, status: doc.status }, data });
    if (updated.count !== 1) throw conflict("Someone else changed this SRS. Reload and try again.");
    await writeAudit(tx, actor, { action: "srs.transition", entityType: "srs", entityId: documentId, before: { status: doc.status }, after: { status: to, note, versionId } });
    await writeActivity(tx, actor, { type: "srs.status", summary: `SRS ${doc.code} moved to ${SRS_STATUS_LABELS[to as SrsStatus] ?? to}`, projectId: project.id, customerId: project.customerId, visibility: doc.clientAccess ? "customer" : "internal", entityType: "srs", entityId: documentId });
    return { versionId };
  });
  const label = SRS_STATUS_LABELS[to as SrsStatus] ?? to;
  const audience = to === "client_input_required" || to === "client_review" || to === "approval_pending" ? "both" : actor.kind === "customer" ? "team" : "team";
  await notifySrs(prisma, actor, doc, project, {
    audience,
    event: to,
    title: to === "approval_pending" ? `Approval requested: ${doc.code}` : to === "client_input_required" ? `Your input is needed: ${project.name}` : `SRS ${label.toLowerCase()}: ${project.name}`,
    body: note || `${actor.name} moved ${doc.code} to ${label.toLowerCase()}.`,
    tab: to === "approval_pending" ? "approval" : to === "client_input_required" ? "wizard" : "overview",
    dedupe: `${to}:${input.version}`,
  });
  scheduleOutbox();
  return result;
}

export async function startRevision(actor: Actor, documentId: string, input: { reason: string; version: number; changeRequestId?: string | null }) {
  requireEmployee(actor);
  requirePermission(actor, "srs.versions");
  const { doc, project } = await loadSrs(prisma, actor, documentId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  if (doc.status !== "approved") throw conflict("Only an approved SRS can be revised.");
  const reason = cleanText(input.reason, 1000);
  if (reason.length < 5) throw validationError("Explain why the approved SRS needs a revision.", { reason: "Give a reason." });
  const updated = await prisma.srsDocument.updateMany({ where: { id: documentId, version: input.version, status: "approved" }, data: { status: "draft", minor: 1, revisionReason: reason, version: { increment: 1 } } });
  if (updated.count !== 1) throw conflict("Someone else changed this SRS. Reload and try again.");
  await writeAudit(prisma, actor, { action: "srs.revision.start", entityType: "srs", entityId: documentId, after: { reason, from: `${doc.major}.0`, to: `${doc.major}.1`, changeRequestId: input.changeRequestId } });
  await writeActivity(prisma, actor, { type: "srs.revision", summary: `Opened revision ${doc.major}.1 of ${doc.code}: ${reason}`, projectId: project.id, customerId: project.customerId, visibility: doc.clientAccess ? "customer" : "internal" });
  await notifySrs(prisma, actor, doc, project, { audience: "both", event: "revision", title: `Revision opened: ${doc.code}`, body: reason, dedupe: `revision:${doc.major}:${input.version}` });
  scheduleOutbox();
}

const DRAWING = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

export async function signSrs(
  actor: Actor,
  documentId: string,
  input: { versionId: string; decision: "approved" | "rejected"; typedName: string; drawing?: string | null; comment?: string; accept: boolean; ipAddress?: string; userAgent?: string },
) {
  const { doc, project } = await loadSrs(prisma, actor, documentId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  const side = actor.kind === "customer" ? "client" : "company";
  requirePermission(actor, side === "client" ? "srs.sign" : "srs.approve");
  const version = await prisma.srsVersion.findFirst({ where: { id: input.versionId, documentId } });
  if (!version || (side === "client" && !version.clientVisible)) throw notFound("Version not found.");
  if (doc.status !== "approval_pending" || version.status !== "in_approval") throw conflict("This version is no longer awaiting approval.");
  const signer = await prisma.user.findFirst({ where: { id: actor.userId, status: "active" } });
  if (!signer) throw forbidden("Your account is not active.");
  if (!input.accept) throw validationError("Confirm the approval statement to continue.", { accept: "Required." });
  const typedName = cleanText(input.typedName, 120);
  if (typedName.toLowerCase().replace(/\s+/g, " ") !== actor.name.trim().toLowerCase().replace(/\s+/g, " ")) throw validationError(`Type your full name exactly as "${actor.name}".`, { typedName: "Must match your account name." });
  const drawing = input.drawing?.trim() || null;
  if (drawing && (!DRAWING.test(drawing) || drawing.length > 400_000)) throw validationError("The drawn signature could not be read. Clear it and try again.");
  const comment = cleanText(input.comment ?? "", 2000);
  if (input.decision === "rejected" && comment.length < 5) throw validationError("Explain what needs to change.", { comment: "Give a reason." });
  const config = (await loadDocInputs(prisma, documentId)).config;
  const role = actor.kind === "customer" ? "Client representative" : (await prisma.userRole.findMany({ where: { userId: actor.userId }, include: { role: true } })).map((r) => r.role.name).join(", ") || "Elec Novatech";
  const statement = `${config.approval.statement} Document ${doc.code}, version ${version.label}, fingerprint ${version.hash.slice(0, 16)}.`;
  const createdAt = new Date();
  const signatureHash = createHash("sha256").update([version.hash, actor.userId, input.decision, typedName, createdAt.toISOString(), drawing ? createHash("sha256").update(drawing).digest("hex") : ""].join("|")).digest("hex");

  let outcome: "pending" | "approved" | "rejected" = "pending";
  try {
    outcome = await prisma.$transaction(async (tx) => {
      await tx.srsSignature.create({
        data: {
          documentId,
          versionId: version.id,
          side,
          signerId: actor.userId,
          signerName: actor.name,
          signerEmail: actor.email,
          signerRole: role,
          decision: input.decision,
          statement,
          method: drawing ? "drawn" : "typed",
          typedName,
          drawing,
          comment,
          snapshotHash: version.hash,
          signatureHash,
          ipAddress: (input.ipAddress ?? "").slice(0, 80),
          userAgent: (input.userAgent ?? "").slice(0, 300),
          createdAt,
        },
      });
      await writeAudit(tx, actor, { action: input.decision === "approved" ? "srs.sign" : "srs.sign.reject", entityType: "srs", entityId: documentId, after: { versionId: version.id, label: version.label, side, signatureHash, method: drawing ? "drawn" : "typed" }, metadata: { ip: input.ipAddress, userAgent: input.userAgent } });
      if (input.decision === "rejected") {
        const closed = await tx.srsVersion.updateMany({ where: { id: version.id, status: "in_approval" }, data: { status: "rejected" } });
        if (closed.count !== 1) throw conflict("This version is no longer awaiting approval.");
        await tx.srsDocument.updateMany({ where: { id: documentId, status: "approval_pending" }, data: { status: "changes_requested", version: { increment: 1 } } });
        return "rejected" as const;
      }
      const signatures = await tx.srsSignature.findMany({ where: { versionId: version.id, decision: "approved" } });
      const client = signatures.filter((s) => s.side === "client").length;
      const company = signatures.filter((s) => s.side === "company").length;
      if (client < config.approval.clientSigners || company < config.approval.companySigners) return "pending" as const;
      const finalized = await tx.srsVersion.updateMany({ where: { id: version.id, status: "in_approval" }, data: { status: "approved", approvedAt: createdAt } });
      if (finalized.count !== 1) return "pending" as const;
      await tx.srsVersion.updateMany({ where: { documentId, status: "approved", id: { not: version.id } }, data: { status: "superseded", supersededAt: createdAt } });
      const model = JSON.parse(version.snapshot) as DocModel;
      const keys = model.groups.flatMap((g) => g.sections.flatMap((s) => s.blocks.flatMap((b) => (b.type === "items" ? b.items.map((i) => i.key) : []))));
      await tx.srsItem.updateMany({ where: { documentId, key: { in: keys }, status: { in: ["draft", "under_review"] } }, data: { status: "approved", approvedAt: createdAt, approvedByName: "SRS approval" } });
      await tx.srsItem.updateMany({ where: { documentId, key: { in: keys } }, data: { baselineVersionId: version.id, reapprovalRequired: false } });
      await tx.srsItem.updateMany({ where: { documentId, key: { in: keys }, approvedAt: null }, data: { approvedAt: createdAt } });
      await tx.srsDocument.update({ where: { id: documentId }, data: { status: "approved", major: doc.major + 1, minor: 0, approvedVersionId: version.id, revisionReason: "", version: { increment: 1 } } });
      await tx.changeRequest.updateMany({ where: { srsDocumentId: documentId, status: "approved", srsVersionId: null }, data: { srsVersionId: version.id, outcome: `Included in SRS version ${version.label}` } });
      await writeAudit(tx, actor, { action: "srs.approved", entityType: "srs", entityId: documentId, after: { versionId: version.id, label: version.label, hash: version.hash, client, company } });
      await writeActivity(tx, actor, { type: "srs.approved", summary: `SRS ${doc.code} version ${version.label} approved`, projectId: project.id, customerId: project.customerId, visibility: "customer", entityType: "srs", entityId: documentId });
      return "approved" as const;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw conflict("You have already recorded a decision on this version.");
    throw error;
  }
  if (outcome === "approved") {
    try {
      const { storeApprovedArtifacts } = await import("@/lib/domain/srs/artifacts");
      await storeApprovedArtifacts(version.id, actor.name);
    } catch (error) {
      log("error", "srs.artifact_failed", { versionId: version.id, reason: error instanceof Error ? error.message : "unknown" });
      await writeAudit(prisma, actor, { action: "srs.artifact.failed", entityType: "srs", entityId: documentId, metadata: { versionId: version.id } });
    }
  }
  const title = outcome === "approved" ? `SRS approved: ${doc.code} v${version.label}` : outcome === "rejected" ? `Changes requested on ${doc.code}` : `${actor.name} ${input.decision === "approved" ? "approved" : "rejected"} ${doc.code}`;
  await notifySrs(prisma, actor, doc, project, { audience: "both", event: `sign-${outcome}`, title, body: comment || `${actor.name} recorded a decision on version ${version.label}.`, tab: "approval", dedupe: `sign:${version.id}:${actor.userId}:${outcome}` });
  scheduleOutbox();
  return { outcome };
}

const CLASSIFICATIONS = ["in_scope", "clarification", "defect", "change_request"];

export async function submitChangeRequest(
  actor: Actor,
  documentId: string,
  input: { title: string; reason: string; classification?: string; affectedKeys?: string[]; scopeImpact?: string; timelineImpact?: string; effortImpact?: string; commercialImpact?: string; risks?: string; estimatedMinutes?: number; estimatedCostCents?: number | null },
) {
  requirePermission(actor, "changes.create");
  const { doc, project } = await loadSrs(prisma, actor, documentId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  const title = cleanText(input.title, 180);
  const reason = cleanText(input.reason, 4000);
  if (title.length < 3) throw validationError("Give the request a short title.", { title: "Required." });
  if (reason.length < 5) throw validationError("Describe what you need and why.", { reason: "Required." });
  assertNoSecrets(title, reason, input.scopeImpact, input.risks);
  const classification = actor.kind === "customer" ? "unclassified" : CLASSIFICATIONS.includes(input.classification ?? "") ? input.classification! : "unclassified";
  const keys = (input.affectedKeys ?? []).map((k) => k.trim().toUpperCase()).filter(Boolean);
  if (keys.length) {
    const found = await prisma.srsItem.findMany({ where: { documentId, key: { in: keys }, ...visibilityWhere(actor) }, select: { key: true } });
    const missing = keys.filter((k) => !found.some((f) => f.key === k));
    if (missing.length) throw validationError(`Unknown requirement IDs: ${missing.join(", ")}`);
  }
  const employee = actor.kind === "employee";
  const change = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, actor.organizationId, `change:${project.id}`, "CR");
    const created = await tx.changeRequest.create({
      data: {
        organizationId: actor.organizationId,
        projectId: project.id,
        code,
        title,
        reason,
        status: "requested",
        requestedById: actor.userId,
        requesterName: actor.name,
        srsDocumentId: documentId,
        classification,
        affectedItemKeys: JSON.stringify(keys),
        scopeImpact: employee ? cleanText(input.scopeImpact ?? "", 4000) : "",
        timelineImpact: employee ? cleanText(input.timelineImpact ?? "", 1000) : "",
        effortImpact: employee ? cleanText(input.effortImpact ?? "", 1000) : "",
        commercialImpact: employee ? cleanText(input.commercialImpact ?? "", 1000) : "",
        risks: employee ? cleanText(input.risks ?? "", 2000) : "",
        estimatedMinutes: employee ? Math.max(0, Math.round(input.estimatedMinutes ?? 0)) : 0,
        estimatedCostCents: employee ? input.estimatedCostCents ?? null : null,
        currency: actor.currency,
        customerVisible: true,
      },
    });
    await writeAudit(tx, actor, { action: "srs.change.create", entityType: "change_request", entityId: created.id, after: { code, title, classification, keys } });
    await writeActivity(tx, actor, { type: "change.requested", summary: `${code} requested: ${title}`, projectId: project.id, customerId: project.customerId, visibility: "customer", entityType: "change_request", entityId: created.id });
    return created;
  });
  await notifySrs(prisma, actor, doc, project, { audience: actor.kind === "customer" ? "team" : "client", event: "change", title: `Change request ${change.code}: ${title}`, body: reason.slice(0, 280), tab: "changes", dedupe: `change:${change.id}` });
  scheduleOutbox();
  return { id: change.id, code: change.code };
}

export async function assessChangeRequest(
  actor: Actor,
  changeId: string,
  input: { classification: string; scopeImpact?: string; timelineImpact?: string; effortImpact?: string; commercialImpact?: string; risks?: string; estimatedMinutes?: number; estimatedCostCents?: number | null; note?: string; version: number },
) {
  requireEmployee(actor);
  requirePermission(actor, "changes.create");
  const change = await prisma.changeRequest.findFirst({ where: { id: changeId, organizationId: actor.organizationId } });
  if (!change?.srsDocumentId) throw notFound("Change request not found.");
  const { project } = await loadSrs(prisma, actor, change.srsDocumentId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  if (!CLASSIFICATIONS.includes(input.classification)) throw validationError("Choose a classification.");
  if (["approved", "rejected", "closed"].includes(change.status)) throw conflict("This request has already been decided.");
  const closes = input.classification !== "change_request";
  const note = cleanText(input.note ?? "", 2000);
  if (closes && note.length < 5) throw validationError("Explain how this request is handled.", { note: "Required." });
  const result = await prisma.changeRequest.updateMany({
    where: { id: changeId, version: input.version },
    data: {
      classification: input.classification,
      scopeImpact: cleanText(input.scopeImpact ?? change.scopeImpact, 4000),
      timelineImpact: cleanText(input.timelineImpact ?? change.timelineImpact, 1000),
      effortImpact: cleanText(input.effortImpact ?? change.effortImpact, 1000),
      commercialImpact: cleanText(input.commercialImpact ?? change.commercialImpact, 1000),
      risks: cleanText(input.risks ?? change.risks, 2000),
      estimatedMinutes: input.estimatedMinutes ?? change.estimatedMinutes,
      estimatedCostCents: input.estimatedCostCents === undefined ? change.estimatedCostCents : input.estimatedCostCents,
      status: closes ? "closed" : "under_review",
      outcome: closes ? `Handled as ${input.classification.replaceAll("_", " ")}: ${note}` : change.outcome,
      version: { increment: 1 },
    },
  });
  if (result.count !== 1) throw conflict("Someone else updated this request. Reload and try again.");
  await writeAudit(prisma, actor, { action: "srs.change.assess", entityType: "change_request", entityId: changeId, before: { classification: change.classification, status: change.status }, after: { classification: input.classification, note } });
}

export async function decideChangeRequest(actor: Actor, changeId: string, input: { decision: "approved" | "rejected"; note: string; version: number }) {
  requireEmployee(actor);
  requirePermission(actor, "changes.approve");
  const change = await prisma.changeRequest.findFirst({ where: { id: changeId, organizationId: actor.organizationId } });
  if (!change?.srsDocumentId) throw notFound("Change request not found.");
  const { doc, project } = await loadSrs(prisma, actor, change.srsDocumentId);
  if (change.classification !== "change_request" || change.status !== "under_review") throw conflict("Assess and classify this request as a change request first.");
  const note = cleanText(input.note, 2000);
  if (note.length < 5) throw validationError("Record the reason for the decision.", { note: "Required." });
  const result = await prisma.changeRequest.updateMany({ where: { id: changeId, version: input.version, status: "under_review" }, data: { status: input.decision, decisionNote: note, outcome: input.decision === "rejected" ? `Rejected: ${note}` : "Approved — awaiting new SRS version", version: { increment: 1 } } });
  if (result.count !== 1) throw conflict("This request was already decided.");
  const keys = JSON.parse(change.affectedItemKeys || "[]") as string[];
  await writeAudit(prisma, actor, { action: `srs.change.${input.decision}`, entityType: "change_request", entityId: changeId, after: { note, keys } });
  if (input.decision === "approved") {
    if (doc.status === "approved") await startRevision(actor, doc.id, { reason: `${change.code}: ${change.title}`, version: doc.version, changeRequestId: change.id });
    if (keys.length) await prisma.srsItem.updateMany({ where: { documentId: doc.id, key: { in: keys }, approvedAt: { not: null } }, data: { reapprovalRequired: true } });
  }
  if (change.requestedById && change.requestedById !== actor.userId) {
    const requester = await prisma.user.findFirst({ where: { id: change.requestedById, status: "active" } });
    if (requester) {
      await notifyUser(prisma, {
        organizationId: actor.organizationId,
        userId: requester.id,
        type: "change_request",
        title: `${change.code} ${input.decision}`,
        body: note,
        href: srsHref({ kind: requester.kind as Actor["kind"] }, project.id, doc.id, "changes"),
        dedupeKey: `srs-change:${change.id}:${input.decision}`,
        email: { to: requester.email, template: "change_request", payload: { title: change.title, project: project.name, status: input.decision, url: srsHref({ kind: requester.kind as Actor["kind"] }, project.id, doc.id, "changes") } },
      });
    }
  }
  scheduleOutbox();
}

export async function addSrsComment(
  actor: Actor,
  documentId: string,
  input: { body: string; targetType?: string; targetKey?: string; parentId?: string | null; visibility?: string; kind?: string; attachmentIds?: string[] },
) {
  const { doc, project } = await loadSrs(prisma, actor, documentId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  requirePermission(actor, "comments.create");
  const body = cleanText(input.body, 6000);
  if (body.length < 2) throw validationError("Write a comment.", { body: "Required." });
  assertNoSecrets(body);
  let visibility = actor.kind === "customer" ? "shared" : input.visibility === "internal" ? "internal" : "shared";
  if (visibility === "internal") requirePermission(actor, "srs.internal");
  let kind = input.kind === "clarification" ? "clarification" : "comment";
  if (kind === "clarification") requirePermission(actor, "srs.clarify");
  let targetType = ["document", "section", "item", "question"].includes(input.targetType ?? "") ? input.targetType! : "document";
  let targetKey = cleanText(input.targetKey ?? "", 80);
  if (!targetKey) targetType = "document";
  let parent = null as Awaited<ReturnType<typeof prisma.srsComment.findFirst>>;
  if (input.parentId) {
    parent = await prisma.srsComment.findFirst({ where: { id: input.parentId, documentId, ...visibilityWhere(actor) } });
    if (!parent) throw notFound("The comment you replied to is gone.");
    if (parent.parentId) throw validationError("Reply to the top of the thread.");
    visibility = parent.visibility;
    kind = "comment";
    targetType = parent.targetType;
    targetKey = parent.targetKey;
  }
  if (targetType === "item" && targetKey) {
    const item = await prisma.srsItem.findFirst({ where: { documentId, key: targetKey, ...visibilityWhere(actor) } });
    if (!item) throw validationError("That item does not exist.");
    if (item.visibility === "internal") visibility = "internal";
  }
  const attachmentIds = [...new Set(input.attachmentIds ?? [])].slice(0, 10);
  if (attachmentIds.length) {
    const docs = await prisma.document.findMany({ where: { id: { in: attachmentIds }, projectId: project.id, archivedAt: null, ...(visibility === "shared" ? { visibility: "customer" } : {}) } });
    if (docs.length !== attachmentIds.length) throw validationError(visibility === "shared" ? "Only files shared with the client can be attached to a shared comment." : "Attach files from this project.");
  }
  const candidates = await prisma.user.findMany({
    where: {
      organizationId: actor.organizationId,
      status: "active",
      OR: [
        { kind: "employee", OR: [{ id: project.managerId ?? "__none__" }, { memberships: { some: { projectId: project.id } } }] },
        ...(visibility === "shared" && doc.clientAccess ? [{ kind: "customer", customerId: project.customerId }] : []),
      ],
    },
    select: { id: true, name: true, email: true, kind: true },
  });
  const lowered = body.toLowerCase();
  const mentioned = candidates.filter((user) => user.id !== actor.userId && lowered.includes(`@${user.name.toLowerCase()}`));
  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.srsComment.create({
      data: {
        organizationId: actor.organizationId,
        documentId,
        targetType,
        targetKey,
        parentId: parent?.id ?? null,
        body,
        visibility,
        kind,
        status: "open",
        mentions: JSON.stringify(mentioned.map((m) => m.id)),
        attachmentIds: JSON.stringify(attachmentIds),
        authorId: actor.userId,
        authorName: actor.name,
        authorKind: actor.kind,
      },
    });
    if (parent?.kind === "clarification" && parent.status === "open" && parent.authorKind !== actor.kind) await tx.srsComment.update({ where: { id: parent.id }, data: { status: "answered" } });
    if (kind === "clarification" && targetType === "item" && targetKey && !isLocked(doc.status)) {
      await tx.srsItem.updateMany({ where: { documentId, key: targetKey, status: { in: ["draft", "under_review"] } }, data: { status: "clarification_required" } });
    }
    await writeAudit(tx, actor, { action: kind === "clarification" ? "srs.clarification" : "srs.comment", entityType: "srs", entityId: documentId, after: { commentId: created.id, targetType, targetKey, visibility, parentId: parent?.id, mentions: mentioned.length } });
    return created;
  });
  for (const user of mentioned) {
    const href = srsHref({ kind: user.kind as Actor["kind"] }, project.id, doc.id, "discussion");
    await notifyUser(prisma, { organizationId: actor.organizationId, userId: user.id, type: "mention", title: `${actor.name} mentioned you on ${doc.code}`, body: body.slice(0, 200), href, dedupeKey: `srs-mention:${comment.id}:${user.id}`, email: { to: user.email, template: "mention", payload: { actor: actor.name, entity: doc.code, excerpt: body.slice(0, 280), url: href } } });
  }
  if (kind === "clarification" || parent?.kind === "clarification" || actor.kind === "customer") {
    const audience = visibility === "internal" ? "team" : actor.kind === "customer" ? "team" : "client";
    await notifySrs(prisma, actor, doc, project, {
      audience,
      event: "clarification",
      title: kind === "clarification" ? `Clarification needed on ${doc.code}${targetKey ? ` (${targetKey})` : ""}` : `New response on ${doc.code}`,
      body: body.slice(0, 280),
      tab: "discussion",
      dedupe: `comment:${comment.id}`,
    });
  }
  scheduleOutbox();
  return { id: comment.id };
}

export async function resolveSrsComment(actor: Actor, commentId: string) {
  const comment = await prisma.srsComment.findFirst({ where: { id: commentId, organizationId: actor.organizationId } });
  if (!comment) throw notFound("Comment not found.");
  const { doc } = await loadSrs(prisma, actor, comment.documentId);
  if (comment.visibility === "internal" && !canSeeInternal(actor)) throw notFound("Comment not found.");
  if (comment.authorId !== actor.userId) requirePermission(actor, "srs.clarify");
  if (comment.status === "resolved") return;
  await prisma.srsComment.update({ where: { id: commentId }, data: { status: "resolved", resolvedByName: actor.name, resolvedAt: new Date() } });
  if (comment.kind === "clarification" && comment.targetType === "item" && comment.targetKey && !isLocked(doc.status)) {
    const open = await prisma.srsComment.count({ where: { documentId: doc.id, kind: "clarification", targetKey: comment.targetKey, status: { not: "resolved" }, parentId: null } });
    if (!open) await prisma.srsItem.updateMany({ where: { documentId: doc.id, key: comment.targetKey, status: "clarification_required" }, data: { status: "under_review" } });
  }
  await writeAudit(prisma, actor, { action: "srs.comment.resolve", entityType: "srs", entityId: doc.id, after: { commentId } });
}

export async function getSrsWorkspace(actor: Actor, documentId: string) {
  const { doc, project } = await loadSrs(prisma, actor, documentId);
  const inputs = await loadDocInputs(prisma, documentId);
  const internal = canSeeInternal(actor);
  const customer = actor.kind === "customer";
  const [items, comments, versions, signatures, changes, tasks, milestones, documents, artifacts] = await Promise.all([
    prisma.srsItem.findMany({ where: { documentId, ...visibilityWhere(actor) }, include: { criteria: { orderBy: { sort: "asc" } }, links: true, revisions: { orderBy: { revision: "desc" }, take: 20 } }, orderBy: [{ kind: "asc" }, { seq: "asc" }] }),
    prisma.srsComment.findMany({ where: { documentId, ...visibilityWhere(actor) }, orderBy: { createdAt: "asc" } }),
    prisma.srsVersion.findMany({ where: { documentId, ...(customer ? { clientVisible: true } : {}) }, orderBy: { seq: "desc" }, select: { id: true, seq: true, label: true, kind: true, status: true, hash: true, note: true, clientVisible: true, publishedAt: true, createdByName: true, createdAt: true, approvedAt: true, supersededAt: true, changeRequestId: true } }),
    prisma.srsSignature.findMany({ where: { documentId }, orderBy: { createdAt: "asc" }, select: { id: true, versionId: true, side: true, signerId: true, signerName: true, signerRole: true, decision: true, method: true, comment: true, createdAt: true, signatureHash: true, ...(customer ? {} : { ipAddress: true }) } }),
    prisma.changeRequest.findMany({ where: { projectId: project.id, srsDocumentId: documentId, ...(customer ? { customerVisible: true } : {}) }, orderBy: { createdAt: "desc" } }),
    customer ? Promise.resolve([]) : prisma.task.findMany({ where: { projectId: project.id }, select: { id: true, code: true, title: true, status: true }, orderBy: { code: "asc" }, take: 300 }),
    customer ? Promise.resolve([]) : prisma.milestone.findMany({ where: { projectId: project.id }, select: { id: true, code: true, name: true, status: true, dueOn: true }, orderBy: { code: "asc" } }),
    prisma.document.findMany({ where: { projectId: project.id, archivedAt: null, ...(customer ? { visibility: "customer" } : {}) }, select: { id: true, fileName: true, visibility: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.srsArtifact.findMany({ where: { documentId }, select: { versionId: true, format: true, sha256: true, byteSize: true, createdAt: true } }),
  ]);
  const visibleSignatures = customer ? signatures.filter((s) => versions.some((v) => v.id === s.versionId)) : signatures;
  const check = completeness(inputs);
  const sections = inputs.sections.filter((s) => internal || s.visibility === "shared");
  const team = customer ? [] : await prisma.user.findMany({ where: { organizationId: actor.organizationId, kind: "employee", status: "active" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return {
    doc,
    project,
    customerName: inputs.project.customer.name,
    config: inputs.config,
    template: { name: inputs.doc.templateVersion.template.name, version: inputs.doc.templateVersion.version, latest: inputs.doc.templateVersion.template.currentVersion },
    sections,
    answers: inputs.answers,
    items,
    comments,
    versions,
    signatures: visibleSignatures,
    changes,
    tasks,
    milestones,
    documents,
    artifacts,
    team,
    completeness: customer ? { blockers: [], warnings: [], stats: check.stats } : check,
    transitions: allowedTransitions(actor, doc.status),
    internal,
  };
}

export async function compareVersions(actor: Actor, documentId: string, fromId: string, toId: string | "live") {
  const { diffModels } = await import("@/lib/domain/srs/model");
  await loadSrs(prisma, actor, documentId);
  const customer = actor.kind === "customer";
  const from = await prisma.srsVersion.findFirst({ where: { id: fromId, documentId, ...(customer ? { clientVisible: true } : {}) } });
  if (!from) throw notFound("Version not found.");
  let after: DocModel;
  let label: string;
  if (toId === "live") {
    if (customer) throw forbidden("Compare published versions only.");
    after = buildDocModel(await loadDocInputs(prisma, documentId));
    label = "Current draft";
  } else {
    const to = await prisma.srsVersion.findFirst({ where: { id: toId, documentId, ...(customer ? { clientVisible: true } : {}) } });
    if (!to) throw notFound("Version not found.");
    after = JSON.parse(to.snapshot) as DocModel;
    label = to.label;
  }
  return { from: from.label, to: label, entries: diffModels(JSON.parse(from.snapshot) as DocModel, after) };
}

export async function traceability(actor: Actor, documentId: string) {
  requireEmployee(actor);
  const { project } = await loadSrs(prisma, actor, documentId);
  const [items, comments, changes, tasks, milestones, versions] = await Promise.all([
    prisma.srsItem.findMany({ where: { documentId, ...visibilityWhere(actor) }, include: { criteria: true, links: true }, orderBy: [{ kind: "asc" }, { seq: "asc" }] }),
    prisma.srsComment.findMany({ where: { documentId, targetType: "item", ...visibilityWhere(actor) }, select: { targetKey: true, status: true, kind: true } }),
    prisma.changeRequest.findMany({ where: { srsDocumentId: documentId }, select: { code: true, status: true, affectedItemKeys: true } }),
    prisma.task.findMany({ where: { projectId: project.id }, select: { id: true, code: true, status: true } }),
    prisma.milestone.findMany({ where: { projectId: project.id }, select: { id: true, code: true, status: true } }),
    prisma.srsVersion.findMany({ where: { documentId }, select: { id: true, label: true } }),
  ]);
  const referencing = (key: string, kinds: string[]) =>
    items.filter((other) => kinds.includes(other.kind) && (other.links.some((l) => l.targetType === "item" && l.targetId === items.find((i) => i.key === key)?.id) || Object.values(JSON.parse(other.data || "{}") as Record<string, unknown>).some((v) => typeof v === "string" && new RegExp(`\\b${key}\\b`).test(v)))).map((o) => o.key);
  return items
    .filter((item) => item.kind === "functional" || item.kind === "nonfunctional")
    .map((item) => {
      const data = JSON.parse(item.data || "{}") as Record<string, string>;
      const relatedKeys = (data.related ?? "").match(/\b[A-Z]+-\d{3}\b/g) ?? [];
      return {
        id: item.id,
        key: item.key,
        title: item.title,
        status: item.status,
        priority: item.priority,
        stories: [...new Set([...relatedKeys, ...referencing(item.key, ["use_case", "user_story"]), ...item.links.filter((l) => l.targetType === "item").map((l) => items.find((i) => i.id === l.targetId)?.key).filter(Boolean) as string[]])],
        tasks: item.links.filter((l) => l.targetType === "task").map((l) => tasks.find((t) => t.id === l.targetId)).filter(Boolean).map((t) => `${t!.code} (${t!.status.replaceAll("_", " ")})`),
        milestones: item.links.filter((l) => l.targetType === "milestone").map((l) => milestones.find((m) => m.id === l.targetId)).filter(Boolean).map((m) => `${m!.code} (${m!.status.replaceAll("_", " ")})`),
        tests: { total: item.criteria.length, passed: item.criteria.filter((c) => c.qaStatus === "passed").length, failed: item.criteria.filter((c) => c.qaStatus === "failed").length },
        changes: changes.filter((c) => (JSON.parse(c.affectedItemKeys || "[]") as string[]).includes(item.key)).map((c) => `${c.code} (${c.status})`),
        comments: comments.filter((c) => c.targetKey === item.key).length,
        approval: item.approvedAt ? `Approved${item.baselineVersionId ? ` in v${versions.find((v) => v.id === item.baselineVersionId)?.label ?? "?"}` : ""}${item.reapprovalRequired ? " · re-approval needed" : ""}` : "Not approved",
        deliverables: referencing(item.key, ["deliverable"]),
      };
    });
}

export async function srsDeliveryGate(db: Db, projectId: string) {
  const docs = await db.srsDocument.findMany({ where: { projectId, approvedVersionId: { not: null }, status: { notIn: ["archived", "superseded"] } }, select: { id: true, code: true } });
  if (!docs.length) return [];
  const items = await db.srsItem.findMany({ where: { documentId: { in: docs.map((d) => d.id) }, kind: { in: ["functional", "nonfunctional"] }, priority: "must", baselineVersionId: { not: null }, status: { notIn: ["deferred", "deprecated", "rejected"] } }, include: { criteria: true } });
  return items.filter((item) => item.status !== "verified" || item.criteria.some((c) => !["passed", "na"].includes(c.qaStatus))).map((item) => item.key);
}

export type Signer = DocSigner;
