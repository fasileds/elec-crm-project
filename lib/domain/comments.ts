import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { requirePermission } from "@/lib/actor";
import { loadProject } from "@/lib/domain/access";
import { leadScope } from "@/lib/domain/crm";
import { notifyUser, rememberIdempotency, replayOrClaim, scheduleOutbox, writeActivity, writeAudit, type Db } from "@/lib/domain/support";
import { forbidden, validationError } from "@/lib/errors";
import { cleanText } from "@/lib/text";

const VISIBLE = ["customer", "project", "task", "requirement", "document", "milestone", "change_request", "lead", "opportunity"] as const;

export async function listComments(actor: Actor, entityType: string, entityId: string) {
  const scope = await scopeFor(actor, entityType, entityId);
  const comments = await prisma.comment.findMany({
    where: {
      organizationId: actor.organizationId,
      entityType,
      entityId,
      ...(actor.kind === "customer" ? { visibility: "customer", customerId: actor.customerId } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: { reactions: true, revisions: { select: { id: true, createdAt: true, editorName: true } } },
  });
  return comments.map((comment) => ({
    id: comment.id,
    authorName: comment.authorName,
    authorId: comment.authorId,
    body: comment.deletedAt ? "" : comment.body,
    deleted: Boolean(comment.deletedAt),
    visibility: comment.visibility,
    parentId: comment.parentId,
    createdAt: comment.createdAt,
    editedAt: comment.editedAt,
    resolvedAt: comment.resolvedAt,
    reactions: comment.reactions.map((reaction) => ({ emoji: reaction.emoji, userId: reaction.userId })),
    revisionCount: comment.revisions.length,
    scope,
  }));
}

export async function createComment(
  actor: Actor,
  input: { entityType: string; entityId: string; body: string; visibility?: "internal" | "customer"; parentId?: string | null; mentionIds?: string[]; idempotencyKey?: string | null },
) {
  requirePermission(actor, "comments.create");
  const body = cleanText(input.body, 8000);
  if (body.length < 1) throw validationError("Write a comment before sending it.", { body: "Enter a comment." });
  const visibility = actor.kind === "customer" ? "customer" : input.visibility === "customer" ? "customer" : "internal";
  if ((input.entityType === "lead" || input.entityType === "opportunity") && visibility === "customer") throw forbidden("CRM notes stay inside the company.");
  if (visibility === "internal" && actor.kind === "customer") throw forbidden("Customers cannot create internal notes.");
  if (visibility === "internal") requirePermission(actor, "comments.internal");
  const scope = await scopeFor(actor, input.entityType, input.entityId);
  return prisma.$transaction(async (tx) => {
    const replay = await replayOrClaim(tx, actor, input.idempotencyKey, "comment");
    if (replay) return { id: replay, replayed: true };
    const mentions = await allowedMentions(tx, actor, scope, input.mentionIds ?? [], visibility);
    const comment = await tx.comment.create({
      data: {
        organizationId: actor.organizationId,
        customerId: scope.customerId,
        projectId: scope.projectId,
        taskId: input.entityType === "task" ? input.entityId : null,
        authorId: actor.userId,
        authorName: actor.name,
        body,
        visibility,
        entityType: input.entityType,
        entityId: input.entityId,
        parentId: input.parentId,
        mentions: JSON.stringify(mentions.map((person) => person.id)),
      },
    });
    await writeActivity(tx, actor, {
      type: "comment.created",
      summary: visibility === "customer" ? `${actor.name} commented` : `${actor.name} added an internal note`,
      customerId: scope.customerId,
      projectId: scope.projectId,
      visibility,
      entityType: input.entityType,
      entityId: input.entityId,
    });
    const recipients = new Map<string, { id: string; email: string; reason: "mention" | "reply" }>();
    for (const person of mentions) recipients.set(person.id, { ...person, reason: "mention" });
    if (input.parentId) {
      const parent = await tx.comment.findFirst({ where: { id: input.parentId, organizationId: actor.organizationId }, include: { author: true } });
      if (parent?.author && parent.author.id !== actor.userId && parent.visibility === visibility) {
        recipients.set(parent.author.id, { id: parent.author.id, email: parent.author.email, reason: "reply" });
      }
    }
    for (const person of recipients.values()) {
      await notifyUser(tx, {
        organizationId: actor.organizationId,
        userId: person.id,
        type: person.reason === "mention" ? "mention" : "comment",
        title: person.reason === "mention" ? `${actor.name} mentioned you` : `${actor.name} replied`,
        body: body.slice(0, 180),
        href: scope.href,
        dedupeKey: `comment:${comment.id}:${person.id}`,
        email: { to: person.email, template: person.reason === "mention" ? "mention" : "comment", payload: { actor: actor.name, entity: input.entityType, excerpt: body.slice(0, 180), url: scope.href } },
      });
    }
    await rememberIdempotency(tx, actor, input.idempotencyKey, "comment", comment.id);
    return { id: comment.id, replayed: false };
  }).finally(() => scheduleOutbox());
}

export async function editComment(actor: Actor, id: string, body: string) {
  const comment = await prisma.comment.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!comment || comment.deletedAt) throw validationError("Comment not found.");
  if (actor.kind === "customer" && (comment.visibility !== "customer" || comment.customerId !== actor.customerId)) throw forbidden();
  if (comment.authorId !== actor.userId) requirePermission(actor, "comments.moderate");
  const next = cleanText(body, 8000);
  await prisma.$transaction([
    prisma.commentRevision.create({ data: { commentId: id, body: comment.body, editorId: actor.userId, editorName: actor.name } }),
    prisma.comment.update({ where: { id }, data: { body: next, editedAt: new Date() } }),
  ]);
  await writeAudit(prisma, actor, { action: "comment.edit", entityType: "comment", entityId: id });
}

export async function deleteComment(actor: Actor, id: string) {
  const comment = await prisma.comment.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!comment) throw validationError("Comment not found.");
  if (comment.authorId !== actor.userId) requirePermission(actor, "comments.moderate");
  await prisma.$transaction([
    prisma.commentRevision.create({ data: { commentId: id, body: comment.body, editorId: actor.userId, editorName: actor.name } }),
    prisma.comment.update({ where: { id }, data: { deletedAt: new Date(), body: "" } }),
  ]);
  await writeAudit(prisma, actor, { action: "comment.delete", entityType: "comment", entityId: id });
}

export async function setReaction(actor: Actor, id: string, emoji: string) {
  const comment = await prisma.comment.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!comment) throw validationError("Comment not found.");
  if (actor.kind === "customer" && comment.visibility !== "customer") throw forbidden();
  if (!["ack", "yes", "question"].includes(emoji)) throw validationError("Choose a supported reaction.");
  const existing = await prisma.commentReaction.findUnique({ where: { commentId_userId_emoji: { commentId: id, userId: actor.userId, emoji } } });
  if (existing) await prisma.commentReaction.delete({ where: { id: existing.id } });
  else await prisma.commentReaction.create({ data: { commentId: id, userId: actor.userId, emoji } });
}

async function scopeFor(actor: Actor, entityType: string, entityId: string) {
  if (!VISIBLE.includes(entityType as (typeof VISIBLE)[number])) throw validationError("Comments are not available on this record.");
  if (entityType === "lead" || entityType === "opportunity") {
    if (actor.kind === "customer") throw forbidden("Customers cannot open internal CRM notes.");
    if (entityType === "lead") {
      requirePermission(actor, "leads.view");
      const lead = await prisma.lead.findFirst({ where: { id: entityId, organizationId: actor.organizationId, ...leadScope(actor) }, select: { id: true, customerId: true } });
      if (!lead) throw validationError("That record is not available.");
      return { customerId: lead.customerId, projectId: null, href: `/leads/${lead.id}` };
    }
    requirePermission(actor, "opportunities.view");
    const opportunity = await prisma.opportunity.findFirst({
      where: { id: entityId, organizationId: actor.organizationId, ...(actor.permissions.includes("reports.view") || actor.permissions.includes("leads.assign") ? {} : { ownerId: actor.userId }) },
      select: { id: true, customerId: true },
    });
    if (!opportunity) throw validationError("That record is not available.");
    return { customerId: opportunity.customerId, projectId: null, href: `/opportunities/${opportunity.id}` };
  }
  if (entityType === "project" || entityType === "customer") {
    if (entityType === "customer") {
      const { loadCustomer } = await import("@/lib/domain/access");
      const customer = await loadCustomer(prisma, actor, entityId);
      return { customerId: customer.id, projectId: null, href: `/customers/${customer.id}` };
    }
    const project = await loadProject(prisma, actor, entityId);
    return { customerId: project.customerId, projectId: project.id, href: `/projects/${project.id}` };
  }
  const map = {
    task: prisma.task.findFirst({ where: { id: entityId, organizationId: actor.organizationId }, include: { project: true } }),
    requirement: prisma.requirement.findFirst({ where: { id: entityId, organizationId: actor.organizationId }, include: { project: true } }),
    milestone: prisma.milestone.findFirst({ where: { id: entityId, organizationId: actor.organizationId }, include: { project: true } }),
    change_request: prisma.changeRequest.findFirst({ where: { id: entityId, organizationId: actor.organizationId }, include: { project: true } }),
    document: prisma.document.findFirst({ where: { id: entityId, organizationId: actor.organizationId }, include: { project: true } }),
  } as const;
  const record = await map[entityType as keyof typeof map];
  if (!record || !("project" in record) || !record.project) throw validationError("That record is not available.");
  await loadProject(prisma, actor, record.project.id);
  if (actor.kind === "customer") {
    const visible = "customerVisible" in record ? record.customerVisible : "visibility" in record ? record.visibility === "customer" : false;
    if (!visible) throw forbidden("That record is not visible to customers.");
  }
  return { customerId: record.project.customerId, projectId: record.project.id, href: `/projects/${record.project.id}` };
}

async function allowedMentions(db: Db, actor: Actor, scope: { customerId: string | null; projectId: string | null }, ids: string[], visibility: string) {
  if (!ids.length) return [];
  const users = await db.user.findMany({
    where: { id: { in: ids }, organizationId: actor.organizationId, status: "active" },
    select: { id: true, email: true, kind: true, customerId: true },
  });
  const allowed = [];
  for (const user of users) {
    if (user.kind === "customer" && (visibility !== "customer" || user.customerId !== scope.customerId)) continue;
    if (user.kind === "employee" && scope.projectId) {
      const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId: scope.projectId, userId: user.id } } });
      const project = await db.project.findUnique({ where: { id: scope.projectId }, select: { managerId: true } });
      if (!member && project?.managerId !== user.id && user.id !== actor.userId) continue;
    }
    allowed.push(user);
  }
  return allowed;
}
