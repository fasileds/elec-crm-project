import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { requirePermission } from "@/lib/actor";
import { loadProject } from "@/lib/domain/access";
import { refreshProjectHealth } from "@/lib/domain/projects";
import {
  assertEnabledLookup,
  nextCode,
  notifyUser,
  rememberIdempotency,
  replayOrClaim,
  scheduleOutbox,
  writeActivity,
  writeAudit,
} from "@/lib/domain/support";
import { CHANGE_TRANSITIONS, REQUIREMENT_TRANSITIONS, canTransition } from "@/lib/domain/workflow";
import { conflict, forbidden, validationError } from "@/lib/errors";
import { cleanText, searchBlob } from "@/lib/text";

export async function createRequirement(
  actor: Actor,
  input: { projectId: string; title: string; description?: string; acceptance?: string; priority?: string; source?: string; idempotencyKey?: string | null },
) {
  requirePermission(actor, actor.kind === "customer" ? "changes.create" : "requirements.create");
  const project = await loadProject(prisma, actor, input.projectId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  const title = cleanText(input.title, 180);
  if (title.length < 3) throw validationError("Describe the requirement.", { title: "Enter a title." });
  return prisma.$transaction(async (tx) => {
    const replay = await replayOrClaim(tx, actor, input.idempotencyKey, "requirement");
    if (replay) return { id: replay, replayed: true, changeRequestId: null as string | null };
    if (input.priority) await assertEnabledLookup(tx, actor.organizationId, "priority", input.priority);
    let changeRequestId: string | null = null;
    if (project.scopeBaselinedAt || actor.kind === "customer") {
      const code = await nextCode(tx, actor.organizationId, `change:${project.id}`, "CR");
      const change = await tx.changeRequest.create({
        data: {
          organizationId: actor.organizationId,
          projectId: project.id,
          code,
          title,
          reason: cleanText(input.description ?? "Requested after the scope baseline.", 8000),
          scopeImpact: "Adds work outside the approved baseline.",
          requestedById: actor.userId,
          requesterName: actor.name,
          customerVisible: true,
          currency: actor.currency,
        },
      });
      changeRequestId = change.id;
      await writeActivity(tx, actor, {
        type: "change.requested",
        summary: `Change requested: ${title}. The approved scope was not modified.`,
        projectId: project.id,
        customerId: project.customerId,
        visibility: "customer",
      });
    }
    const code = await nextCode(tx, actor.organizationId, `requirement:${project.id}`, "REQ");
    const requirement = await tx.requirement.create({
      data: {
        organizationId: actor.organizationId,
        projectId: project.id,
        code,
        title,
        description: cleanText(input.description ?? "", 8000),
        acceptance: cleanText(input.acceptance ?? "", 8000),
        priority: input.priority ?? "medium",
        source: input.source ?? (actor.kind === "customer" ? "customer" : "internal"),
        status: changeRequestId ? "draft" : "proposed",
        ownerId: actor.kind === "employee" ? actor.userId : null,
        baseline: false,
        changeRequestId,
        customerVisible: true,
        searchText: searchBlob([title, code, input.description, project.name]),
      },
    });
    await tx.requirementHistory.create({
      data: { requirementId: requirement.id, actorId: actor.userId, actorName: actor.name, version: 1, snapshot: JSON.stringify({ title, status: requirement.status }) },
    });
    await writeAudit(tx, actor, { action: "requirement.create", entityType: "requirement", entityId: requirement.id, after: { title, changeRequestId } });
    await rememberIdempotency(tx, actor, input.idempotencyKey, "requirement", requirement.id);
    return { id: requirement.id, changeRequestId, replayed: false };
  });
}

export async function updateRequirement(
  actor: Actor,
  id: string,
  version: number,
  input: { title?: string; description?: string; acceptance?: string; priority?: string },
) {
  requirePermission(actor, "requirements.edit");
  const current = await prisma.requirement.findFirst({ where: { id, organizationId: actor.organizationId }, include: { project: true } });
  if (!current) throw validationError("Requirement not found.");
  if (current.project.archivedAt) throw conflict("Archived projects are read-only.");
  const material = ["approved", "verified", "implemented"].includes(current.status) && (input.title || input.description || input.acceptance);
  const title = input.title ? cleanText(input.title, 180) : current.title;
  const result = await prisma.requirement.updateMany({
    where: { id, version },
    data: {
      title,
      description: input.description == null ? current.description : cleanText(input.description, 8000),
      acceptance: input.acceptance == null ? current.acceptance : cleanText(input.acceptance, 8000),
      priority: input.priority ?? current.priority,
      status: material ? "proposed" : current.status,
      baseline: material ? false : current.baseline,
      version: { increment: 1 },
      searchText: searchBlob([title, current.code, input.description, current.project.name]),
    },
  });
  if (result.count !== 1) throw conflict("Someone else updated this requirement. Reload and try again.");
  await prisma.requirementHistory.create({
    data: {
      requirementId: id,
      actorId: actor.userId,
      actorName: actor.name,
      version: current.version + 1,
      snapshot: JSON.stringify({ before: { title: current.title, status: current.status }, after: { title, status: material ? "proposed" : current.status } }),
    },
  });
  if (material) {
    await requestApproval(actor, "requirement", id, current.projectId);
    await writeActivity(prisma, actor, { type: "requirement.reapproval", summary: `${current.code} changed after approval and needs a new decision`, projectId: current.projectId, customerId: current.project.customerId, visibility: "customer" });
  }
  await writeAudit(prisma, actor, { action: "requirement.update", entityType: "requirement", entityId: id, before: { title: current.title, status: current.status }, after: { title, reapproval: material } });
}

export async function transitionRequirement(actor: Actor, id: string, status: string, version: number) {
  const permission = status === "approved" || status === "rejected" ? "requirements.approve" : "requirements.edit";
  requirePermission(actor, permission);
  const current = await prisma.requirement.findFirst({ where: { id, organizationId: actor.organizationId }, include: { project: true } });
  if (!current) throw validationError("Requirement not found.");
  if (current.project.archivedAt) throw conflict("Archived projects are read-only.");
  if (!canTransition(REQUIREMENT_TRANSITIONS, current.status, status)) throw validationError(`Cannot move this requirement from ${current.status} to ${status}.`);
  if (current.changeRequestId && status === "approved") {
    const change = await prisma.changeRequest.findUnique({ where: { id: current.changeRequestId } });
    if (!change || !["approved", "scheduled", "implemented", "verified", "closed"].includes(change.status)) {
      throw validationError("Approve the change request before adding this work to the project.");
    }
  }
  const result = await prisma.requirement.updateMany({
    where: { id, version },
    data: { status, baseline: status === "approved" ? true : current.baseline, version: { increment: 1 } },
  });
  if (result.count !== 1) throw conflict("This requirement was already updated.");
  await prisma.requirementHistory.create({
    data: { requirementId: id, actorId: actor.userId, actorName: actor.name, version: version + 1, snapshot: JSON.stringify({ status }) },
  });
  await writeActivity(prisma, actor, { type: "requirement.status", summary: `${current.code} ${status}`, projectId: current.projectId, customerId: current.project.customerId, visibility: "customer" });
}

export async function baselineScope(actor: Actor, projectId: string) {
  requirePermission(actor, "requirements.approve");
  const project = await loadProject(prisma, actor, projectId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  const approved = await prisma.requirement.count({ where: { projectId, status: "approved" } });
  if (!approved) throw validationError("Approve at least one requirement before baselining scope.");
  await prisma.$transaction([
    prisma.requirement.updateMany({ where: { projectId, status: "approved" }, data: { baseline: true } }),
    prisma.project.update({ where: { id: projectId }, data: { scopeBaselinedAt: new Date() } }),
    prisma.onboardingItem.updateMany({ where: { projectId, templateKey: "approve_scope" }, data: { done: true, doneAt: new Date(), doneById: actor.userId } }),
  ]);
  await writeAudit(prisma, actor, { action: "project.baseline", entityType: "project", entityId: projectId, after: { approved } });
  await writeActivity(prisma, actor, { type: "scope.baselined", summary: "Approved the project scope baseline", projectId, customerId: project.customerId, visibility: "customer" });
}

export async function transitionChange(actor: Actor, id: string, status: string, version: number, decisionNote?: string) {
  const current = await prisma.changeRequest.findFirst({ where: { id, organizationId: actor.organizationId }, include: { project: true } });
  if (!current) throw validationError("Change request not found.");
  await loadProject(prisma, actor, current.projectId);
  if (current.project.archivedAt) throw conflict("Archived projects are read-only.");
  if (["approved", "rejected"].includes(status)) requirePermission(actor, "changes.approve");
  else requirePermission(actor, "changes.create");
  if (!canTransition(CHANGE_TRANSITIONS, current.status, status)) throw validationError(`Cannot move this change from ${current.status} to ${status}.`);
  const result = await prisma.changeRequest.updateMany({
    where: { id, version },
    data: { status, version: { increment: 1 }, decisionNote: decisionNote ?? current.decisionNote },
  });
  if (result.count !== 1) throw conflict("This change request was already updated.");
  await writeAudit(prisma, actor, { action: "change.transition", entityType: "change_request", entityId: id, before: { status: current.status }, after: { status, decisionNote } });
  await writeActivity(prisma, actor, { type: "change.status", summary: `${current.code} ${status.replaceAll("_", " ")}. Scope text was left unchanged.`, projectId: current.projectId, customerId: current.project.customerId, visibility: "customer" });
  if (current.requestedById && current.requestedById !== actor.userId) {
    const requester = await prisma.user.findUnique({ where: { id: current.requestedById } });
    if (requester) {
      await notifyUser(prisma, {
        organizationId: actor.organizationId,
        userId: requester.id,
        type: "change_request",
        title: `Change request ${status}`,
        body: `${current.title} is now ${status}.`,
        href: `/projects/${current.projectId}`,
        dedupeKey: `change:${id}:${status}`,
        email: { to: requester.email, template: "change_request", payload: { title: current.title, project: current.project.name, status, url: `/projects/${current.projectId}` } },
      });
    }
  }
  await refreshProjectHealth(current.projectId, actor.timezone);
  scheduleOutbox();
}

export async function requestApproval(actor: Actor, entityType: string, entityId: string, projectId: string | null) {
  requirePermission(actor, "requirements.edit");
  const existing = await prisma.approval.findFirst({ where: { organizationId: actor.organizationId, entityType, entityId, status: "pending" } });
  if (existing) return existing;
  return prisma.approval.create({
    data: { organizationId: actor.organizationId, projectId, entityType, entityId, requestedById: actor.userId, status: "pending" },
  });
}

export async function decideApproval(actor: Actor, id: string, decision: "approved" | "rejected", comment: string) {
  requirePermission(actor, "approvals.decide");
  const approval = await prisma.approval.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!approval) throw validationError("Approval not found.");
  if (approval.projectId) await loadProject(prisma, actor, approval.projectId);
  if (approval.status !== "pending") throw conflict("This approval has already been decided.");
  if (actor.kind === "customer" && approval.entityType === "requirement") {
    const requirement = await prisma.requirement.findFirst({ where: { id: approval.entityId, customerVisible: true, project: { customerId: actor.customerId ?? "__none__" } } });
    if (!requirement) throw forbidden("You cannot decide this approval.");
  }
  const result = await prisma.approval.updateMany({
    where: { id, status: "pending" },
    data: { status: decision, actorId: actor.userId, actorName: actor.name, comment: cleanText(comment, 2000), decidedAt: new Date() },
  });
  if (result.count !== 1) throw conflict("This approval has already been decided.");
  if (approval.entityType === "requirement" && decision === "approved") {
    await prisma.requirement.updateMany({ where: { id: approval.entityId, status: { in: ["draft", "proposed"] } }, data: { status: "approved", baseline: true } });
  }
  if (approval.entityType === "requirement" && decision === "rejected") {
    await prisma.requirement.updateMany({ where: { id: approval.entityId }, data: { status: "rejected" } });
  }
  if (approval.entityType === "change_request" && (decision === "approved" || decision === "rejected")) {
    await prisma.changeRequest.updateMany({ where: { id: approval.entityId, status: { in: ["requested", "under_review"] } }, data: { status: decision, decisionNote: cleanText(comment, 2000) } });
  }
  await writeAudit(prisma, actor, { action: "approval.decide", entityType: approval.entityType, entityId: approval.entityId, after: { decision, comment } });
  await writeActivity(prisma, actor, {
    type: "approval.decided",
    summary: `${approval.entityType.replaceAll("_", " ")} ${decision}`,
    projectId: approval.projectId,
    visibility: "customer",
  });
}

export async function listApprovals(actor: Actor, status = "pending") {
  requirePermission(actor, "approvals.decide");
  return prisma.approval.findMany({
    where: {
      organizationId: actor.organizationId,
      status,
      ...(actor.kind === "customer" ? { project: { customerId: actor.customerId ?? "__none__" } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
