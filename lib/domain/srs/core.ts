import type { Project } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { can, requireEmployee, requirePermission } from "@/lib/actor";
import { loadProject } from "@/lib/domain/access";
import type { Db } from "@/lib/domain/support";
import { notifyUser, scheduleOutbox, writeActivity, writeAudit } from "@/lib/domain/support";
import { AppError, conflict, notFound, validationError } from "@/lib/errors";
import { LOCKED_STATUSES, MASTER_SECTIONS, PROJECT_TYPES } from "@/lib/domain/srs/catalog";
import { parseTemplateConfig, templateVersionFor } from "@/lib/domain/srs/templates";

export const CLIENT_RESPONSE_STATUSES = ["draft", "client_input_required", "client_review", "changes_requested"];

export async function loadSrs(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "srs.view");
  const doc = await db.srsDocument.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!doc) throw notFound("SRS not found.");
  const project = await loadProject(db, actor, doc.projectId);
  if (actor.kind === "customer" && (!doc.clientAccess || doc.status === "archived")) throw notFound("SRS not found.");
  return { doc, project };
}

export function canSeeInternal(actor: Actor) {
  return actor.kind === "employee" && can(actor, "srs.internal");
}

export function visibilityWhere(actor: Actor) {
  return canSeeInternal(actor) ? {} : { visibility: "shared" };
}

export function isLocked(status: string) {
  return LOCKED_STATUSES.includes(status);
}

export function assertEditable(doc: { status: string }, project: Pick<Project, "archivedAt">) {
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  if (isLocked(doc.status)) {
    throw conflict(doc.status === "approval_pending" ? "This SRS is out for approval and locked. Cancel the approval round to edit it." : "This SRS version is locked. Start a revision to change approved content.");
  }
}

export function assertCanWrite(actor: Actor, doc: { status: string; clientAccess: boolean }, permission: "srs.edit" | "srs.requirements") {
  if (actor.kind === "customer") {
    requirePermission(actor, "srs.respond");
    if (!doc.clientAccess || !CLIENT_RESPONSE_STATUSES.includes(doc.status)) throw conflict("This SRS is not open for your input right now.");
    return;
  }
  requirePermission(actor, permission);
}

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(sk|rk|pk)_(live|test)_[0-9a-zA-Z]{12,}/,
  /\bgh[pousr]_[0-9A-Za-z]{30,}\b/,
  /\bxox[abprs]-[0-9A-Za-z-]{10,}/,
  /\bBearer\s+[A-Za-z0-9\-._~+/]{24,}=*/i,
  /\b(api[_-]?key|secret|password|passwd|token|client[_-]?secret)\b\s*[:=]\s*["']?[^\s"']{8,}/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

export function assertNoSecrets(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (value && SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
      throw validationError("This looks like a password, key or token. Describe the approach instead — secrets never belong in an SRS.");
    }
  }
}

export function lockedError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  const triggerAbort = (error as { code?: string }).code === "P2003";
  if (message.includes("SRS is locked") || triggerAbort) throw conflict("This SRS version is locked. Start a revision to change approved content.");
  if (message.includes("immutable") || message.includes("never deleted")) throw conflict("Approved records cannot be changed.");
  throw error;
}

export async function nextItemKey(db: Db, organizationId: string, documentId: string, prefix: string) {
  const row = await db.sequence.upsert({
    where: { organizationId_name: { organizationId, name: `srs:${documentId}:${prefix}` } },
    create: { organizationId, name: `srs:${documentId}:${prefix}`, value: 1 },
    update: { value: { increment: 1 } },
  });
  return { key: `${prefix}-${String(row.value).padStart(3, "0")}`, seq: row.value };
}

export function versionLabel(doc: { major: number; minor: number }) {
  return `${doc.major}.${doc.minor}`;
}

export function srsHref(actor: Pick<Actor, "kind">, projectId: string, docId: string, tab?: string) {
  const base = actor.kind === "customer" ? `/portal/projects/${projectId}/srs` : `/projects/${projectId}/srs`;
  return `${base}?doc=${docId}${tab ? `&tab=${tab}` : ""}`;
}

type Audience = "team" | "client" | "both";

export async function notifySrs(
  db: Db,
  actor: Actor,
  doc: { id: string; code: string; title: string; clientAccess: boolean; projectId: string },
  project: { id: string; name: string; customerId: string; managerId: string | null },
  input: { audience: Audience; event: string; title: string; body: string; tab?: string; dedupe: string; only?: string[] },
) {
  const recipients: Array<{ id: string; email: string; kind: string }> = [];
  if (input.audience !== "client") {
    const members = await db.projectMember.findMany({ where: { projectId: project.id }, select: { userId: true } });
    const ids = [...new Set([project.managerId, ...members.map((m) => m.userId)].filter(Boolean) as string[])];
    recipients.push(...(await db.user.findMany({ where: { id: { in: ids }, status: "active", kind: "employee" }, select: { id: true, email: true, kind: true } })));
  }
  if (input.audience !== "team" && doc.clientAccess) {
    recipients.push(...(await db.user.findMany({ where: { customerId: project.customerId, status: "active", kind: "customer", organizationId: actor.organizationId }, select: { id: true, email: true, kind: true } })));
  }
  const seen = new Set<string>();
  for (const user of recipients) {
    if (user.id === actor.userId || seen.has(user.id) || (input.only && !input.only.includes(user.id))) continue;
    seen.add(user.id);
    const href = srsHref({ kind: user.kind as Actor["kind"] }, project.id, doc.id, input.tab);
    await notifyUser(db, {
      organizationId: actor.organizationId,
      userId: user.id,
      type: "srs",
      title: input.title,
      body: input.body,
      href,
      dedupeKey: `srs:${doc.id}:${input.dedupe}:${user.id}`,
      email: { to: user.email, template: "srs", payload: { title: input.title, body: input.body, document: `${doc.code} · ${project.name}`, url: href } },
    });
  }
}

export function documentCode(projectCode: string, ordinal: number) {
  return `ELEC-NOVA-${projectCode}-SRS${ordinal > 1 ? `-${ordinal}` : ""}`;
}

const DEFAULT_SECTION_TEXT: Record<string, string> = {
  purpose: "",
  change_management:
    "After approval, this specification is the agreed baseline. Any new request is classified as in scope, a clarification, a defect, or a change request. Change requests record the affected requirements and their impact on scope, timeline, effort and cost. Approved change requests produce a new version of this document that is reviewed and signed again; rejected requests remain on record.",
  approval_criteria: "",
};

export async function createSrsDraft(
  db: Db,
  actor: Pick<Actor, "organizationId" | "userId" | "name">,
  project: Pick<Project, "id" | "code" | "name" | "projectType" | "organizationId">,
  ordinal = 1,
) {
  const projectType = PROJECT_TYPES.some(([key]) => key === project.projectType) ? project.projectType : "custom";
  const templateVersion = await templateVersionFor(db, project.organizationId, projectType);
  const config = parseTemplateConfig(templateVersion.config);
  const doc = await db.srsDocument.create({
    data: {
      organizationId: project.organizationId,
      projectId: project.id,
      ordinal,
      code: documentCode(project.code, ordinal),
      title: `${project.name} — Software Requirements Specification`,
      projectType,
      templateVersionId: templateVersion.id,
      confidentiality: config.styling.confidentiality || "Confidential",
      createdById: actor.userId,
      createdByName: actor.name,
      sections: {
        create: config.sections.map((section, sort) => ({
          key: section.key,
          title: section.title,
          sort,
          required: section.required,
          content: DEFAULT_SECTION_TEXT[section.key] ?? "",
          origin: "elec_proposal",
          updatedByName: actor.name,
        })),
      },
    },
  });
  await writeAudit(db, actor, { action: "srs.create", entityType: "srs", entityId: doc.id, after: { code: doc.code, projectId: project.id, template: templateVersion.template.key, templateVersion: templateVersion.version } });
  await writeActivity(db, actor, { type: "srs.created", summary: `Started SRS ${doc.code}`, projectId: project.id, entityType: "srs", entityId: doc.id });
  return doc;
}

export async function listProjectSrs(actor: Actor, projectId: string) {
  requirePermission(actor, "srs.view");
  await loadProject(prisma, actor, projectId);
  return prisma.srsDocument.findMany({
    where: { projectId, organizationId: actor.organizationId, ...(actor.kind === "customer" ? { clientAccess: true, status: { not: "archived" } } : {}) },
    orderBy: { ordinal: "asc" },
  });
}

export async function createSrs(actor: Actor, projectId: string, input: { mode: "continue" | "separate"; reason?: string }) {
  requireEmployee(actor);
  requirePermission(actor, "srs.edit");
  const project = await loadProject(prisma, actor, projectId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  const existing = await prisma.srsDocument.findMany({ where: { projectId }, orderBy: { ordinal: "desc" } });
  const open = existing.find((doc) => doc.status !== "archived" && doc.status !== "superseded");
  if (input.mode === "continue" && open) return { id: open.id, existing: true };
  if (input.mode === "separate" && existing.length && (input.reason ?? "").trim().length < 5) {
    throw validationError("Explain why this project needs a separate SRS.", { reason: "Give a reason." });
  }
  try {
    const doc = await prisma.$transaction(async (tx) => {
      const created = await createSrsDraft(tx, actor, project, (existing[0]?.ordinal ?? 0) + 1);
      if (existing.length) await writeAudit(tx, actor, { action: "srs.create_separate", entityType: "srs", entityId: created.id, metadata: { reason: input.reason } });
      return created;
    });
    return { id: doc.id, existing: false };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const latest = await prisma.srsDocument.findFirst({ where: { projectId }, orderBy: { ordinal: "desc" } });
      if (latest) return { id: latest.id, existing: true };
    }
    throw error;
  }
}

export async function updateSrsSettings(actor: Actor, id: string, input: { clientAccess?: boolean; confidentiality?: string; version: number }) {
  requireEmployee(actor);
  const { doc, project } = await loadSrs(prisma, actor, id);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  if (input.clientAccess !== undefined) requirePermission(actor, "srs.publish");
  else requirePermission(actor, "srs.edit");
  const data: Record<string, unknown> = {};
  if (input.clientAccess !== undefined) data.clientAccess = input.clientAccess;
  if (input.confidentiality !== undefined) {
    if (isLocked(doc.status)) throw conflict("This SRS is locked.");
    data.confidentiality = input.confidentiality.trim().slice(0, 60) || "Confidential";
  }
  const updated = await prisma.srsDocument.updateMany({ where: { id, version: input.version }, data: { ...data, version: { increment: 1 } } });
  if (updated.count !== 1) throw conflict("Someone else updated this SRS. Reload and try again.");
  await writeAudit(prisma, actor, { action: "srs.settings", entityType: "srs", entityId: id, before: { clientAccess: doc.clientAccess }, after: data });
  if (input.clientAccess && !doc.clientAccess) {
    await notifySrs(prisma, actor, { ...doc, clientAccess: true }, project, { audience: "client", event: "access", title: `Requirements workspace opened: ${project.name}`, body: `${actor.name} invited you to review and contribute to the requirements.`, dedupe: `access:${doc.version}` });
    scheduleOutbox();
  }
}

export function sectionTitle(key: string) {
  return MASTER_SECTIONS.find((s) => s.key === key)?.title ?? key;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
