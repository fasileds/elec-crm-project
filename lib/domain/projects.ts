import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { can, requireEmployee, requirePermission } from "@/lib/actor";
import { loadCustomer, loadProject, projectListScope } from "@/lib/domain/access";
import { scoreProjectHealth } from "@/lib/domain/health";
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
import { DEFAULT_PHASES, OPEN_CHANGE, OPEN_TASK, PROJECT_TRANSITIONS, canTransition } from "@/lib/domain/workflow";
import { isPastDate, todayInTimeZone, daysUntil } from "@/lib/dates";
import { conflict, validationError } from "@/lib/errors";
import { cleanText, searchBlob } from "@/lib/text";
import { createSrsDraft } from "@/lib/domain/srs/core";
import { PROJECT_TYPES } from "@/lib/domain/srs/catalog";
import { srsDeliveryGate } from "@/lib/domain/srs/workflow";

const PAGE = 25;

export async function listProjects(actor: Actor, query: { page?: number; q?: string; status?: string; customerId?: string; health?: string }) {
  const page = Math.max(1, query.page ?? 1);
  const q = query.q?.trim().toLowerCase();
  const where = {
    organizationId: actor.organizationId,
    ...projectListScope(actor),
    ...(query.status ? { status: query.status } : { archivedAt: null }),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.health ? { healthStatus: query.health } : {}),
    ...(q ? { searchText: { contains: q } } : {}),
  };
  if (query.status === "archived") delete (where as { archivedAt?: null }).archivedAt;
  const [total, items] = await prisma.$transaction([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        customer: { select: { id: true, name: true, code: true } },
        manager: { select: { id: true, name: true, status: true } },
      },
    }),
  ]);
  return { items: items.map(presentProject), page, pageSize: PAGE, total };
}

export async function getProject(actor: Actor, id: string) {
  const project = await loadProject(prisma, actor, id);
  const [customer, manager] = await Promise.all([
    prisma.customer.findUnique({ where: { id: project.customerId }, select: { id: true, name: true, code: true } }),
    project.managerId ? prisma.user.findUnique({ where: { id: project.managerId }, select: { id: true, name: true, status: true } }) : Promise.resolve(null),
  ]);
  const customerView = actor.kind === "customer";
  const [members, contacts, phases, milestones, requirements, tasks, changes, issues, onboarding, activities, decisions, meetings] = await Promise.all([
    prisma.projectMember.findMany({ where: { projectId: id }, include: { user: { select: { id: true, name: true, email: true, status: true, jobTitle: true } } } }),
    prisma.projectContact.findMany({ where: { projectId: id }, include: { contact: true } }),
    prisma.phase.findMany({ where: { projectId: id }, orderBy: { sort: "asc" } }),
    prisma.milestone.findMany({ where: { projectId: id, ...(customerView ? { customerVisible: true } : {}) }, orderBy: { dueOn: "asc" } }),
    prisma.requirement.findMany({ where: { projectId: id, ...(customerView ? { customerVisible: true } : {}) }, orderBy: { code: "asc" } }),
    prisma.task.findMany({ where: { projectId: id, ...(customerView ? { customerVisible: true } : {}) }, orderBy: { code: "asc" }, take: 200 }),
    prisma.changeRequest.findMany({ where: { projectId: id, ...(customerView ? { customerVisible: true } : {}) }, orderBy: { createdAt: "desc" } }),
    prisma.projectIssue.findMany({ where: { projectId: id, ...(customerView ? { customerVisible: true } : {}) } }),
    prisma.onboardingItem.findMany({ where: { projectId: id }, orderBy: { sort: "asc" } }),
    prisma.activity.findMany({ where: { projectId: id, ...(customerView ? { visibility: "customer" } : {}) }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.decision.findMany({ where: { projectId: id, ...(customerView ? { visibility: "customer" } : {}) }, orderBy: { decidedOn: "desc" } }),
    prisma.meeting.findMany({ where: { projectId: id, ...(customerView ? { visibility: "customer" } : {}) }, orderBy: { startsAt: "desc" } }),
  ]);
  return { ...presentProject({ ...project, customer: customer ?? undefined, manager }), members, contacts, phases, milestones, requirements, tasks, changes, issues, onboarding, activities, decisions, meetings, scope: customerView ? undefined : project.scope, objectives: project.objectives, summary: project.summary };
}

export async function createProject(
  actor: Actor,
  input: { customerId: string; name: string; summary?: string; objectives?: string; scope?: string; priority?: string; managerId?: string; dueOn?: string; projectType?: string; opportunityId?: string | null; idempotencyKey?: string | null },
) {
  requirePermission(actor, "projects.create");
  const customer = await loadCustomer(prisma, actor, input.customerId);
  if (customer.archivedAt) throw conflict("Archived customers cannot receive new projects.");
  const name = cleanText(input.name, 180);
  if (name.length < 2) throw validationError("Enter a project name.", { name: "Enter a project name." });
  const projectType = PROJECT_TYPES.some(([key]) => key === input.projectType) ? input.projectType! : "custom";
  const created = await prisma.$transaction(async (tx) => {
    const replay = await replayOrClaim(tx, actor, input.idempotencyKey, "project");
    if (replay) return { id: replay, replayed: true };
    if (input.opportunityId) {
      const existing = await tx.project.findUnique({ where: { opportunityId: input.opportunityId } });
      if (existing) return { id: existing.id, replayed: true };
    }
    if (input.priority) await assertEnabledLookup(tx, actor.organizationId, "priority", input.priority);
    const code = await nextCode(tx, actor.organizationId, "project", "PRJ");
    const project = await tx.project.create({
      data: {
        organizationId: actor.organizationId,
        customerId: customer.id,
        code,
        name,
        summary: cleanText(input.summary ?? "", 4000),
        objectives: cleanText(input.objectives ?? "", 4000),
        scope: cleanText(input.scope ?? "", 8000),
        priority: input.priority ?? "medium",
        managerId: input.managerId ?? actor.userId,
        dueOn: input.dueOn,
        currency: actor.currency,
        projectType,
        opportunityId: input.opportunityId || null,
        searchText: searchBlob([name, code, customer.name, input.summary]),
        phases: { create: DEFAULT_PHASES.map(([key, phaseName], sort) => ({ organizationId: actor.organizationId, key, name: phaseName, sort })) },
      },
    });
    const templates = await tx.onboardingTemplate.findMany({ where: { organizationId: actor.organizationId, enabled: true }, orderBy: { sort: "asc" } });
    if (templates.length) {
      await tx.onboardingItem.createMany({
        data: templates.map((template) => ({
          projectId: project.id,
          templateKey: template.key,
          label: template.label,
          required: template.required,
          sort: template.sort,
        })),
      });
    }
    await tx.projectMember.create({ data: { projectId: project.id, userId: input.managerId ?? actor.userId, role: "manager" } });
    await createSrsDraft(tx, actor, project);
    await writeAudit(tx, actor, { action: "project.create", entityType: "project", entityId: project.id, after: { name, code, customerId: customer.id, projectType, opportunityId: input.opportunityId } });
    await writeActivity(tx, actor, { type: "project.created", summary: `Opened project ${name}`, customerId: customer.id, projectId: project.id, visibility: "customer", entityType: "project", entityId: project.id });
    if (customer.accountManagerId && customer.accountManagerId !== actor.userId) {
      const manager = await tx.user.findUnique({ where: { id: customer.accountManagerId } });
      if (manager) {
        await notifyUser(tx, {
          organizationId: actor.organizationId,
          userId: manager.id,
          type: "project_created",
          title: `Project opened: ${name}`,
          body: `${actor.name} opened a project for ${customer.name}.`,
          href: `/projects/${project.id}`,
          dedupeKey: `project-created:${project.id}:${manager.id}`,
          email: { to: manager.email, template: "project_created", payload: { actor: actor.name, project: name, customer: customer.name, url: `/projects/${project.id}` } },
        });
      }
    }
    await rememberIdempotency(tx, actor, input.idempotencyKey, "project", project.id);
    return { id: project.id, replayed: false };
  }).catch(async (error: unknown) => {
    if ((error as { code?: string }).code === "P2002" && input.opportunityId) {
      const existing = await prisma.project.findUnique({ where: { opportunityId: input.opportunityId } });
      if (existing) return { id: existing.id, replayed: true };
    }
    throw error;
  });
  scheduleOutbox();
  return created;
}

export async function startProjectFromOpportunity(actor: Actor, opportunityId: string, input: { name?: string; projectType?: string; dueOn?: string; idempotencyKey?: string | null }) {
  requirePermission(actor, "projects.create");
  const opportunity = await prisma.opportunity.findFirst({ where: { id: opportunityId, organizationId: actor.organizationId }, include: { customer: true } });
  if (!opportunity) throw validationError("Opportunity not found.");
  const existing = await prisma.project.findUnique({ where: { opportunityId } });
  if (existing) return { id: existing.id, replayed: true };
  if (opportunity.archivedAt) throw conflict("Archived opportunities cannot start projects.");
  if (opportunity.stage === "lost") throw conflict("Lost opportunities cannot start projects.");
  return createProject(actor, {
    customerId: opportunity.customerId,
    name: input.name?.trim() || opportunity.name,
    summary: opportunity.notes,
    scope: opportunity.requirements,
    projectType: input.projectType,
    dueOn: input.dueOn,
    opportunityId,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function transitionProject(actor: Actor, id: string, status: string, version: number, overrideReason?: string) {
  requirePermission(actor, "projects.transition");
  const project = await loadProject(prisma, actor, id);
  if (project.archivedAt && status !== project.statusBeforeArchive && status !== "archived") {
    throw conflict("Archived projects are read-only except for an authorized restore.");
  }
  await assertEnabledLookup(prisma, actor.organizationId, "project_status", status);
  if (!canTransition(PROJECT_TRANSITIONS, project.status, status) && !(status === "archived" && can(actor, "projects.archive"))) {
    throw validationError(`Cannot move a project from ${project.status} to ${status}.`);
  }
  if (status === "active") {
    const [items, approved] = await Promise.all([
      prisma.onboardingItem.findMany({ where: { projectId: id, required: true, done: false } }),
      prisma.requirement.count({ where: { projectId: id, status: "approved" } }),
    ]);
    if (items.length || approved < 1) {
      throw validationError(
        items.length
          ? `Finish required onboarding before development: ${items.map((item) => item.label).join(", ")}.`
          : "Approve at least one requirement before development starts.",
      );
    }
  }
  if ((status === "completed" || status === "delivered") && !overrideReason) {
    const open = await prisma.task.count({ where: { projectId: id, status: { in: ["in_progress", "blocked"] } } });
    const blockers = await prisma.projectIssue.count({ where: { projectId: id, type: "blocker", status: "open" } });
    if (open || blockers) throw validationError("Resolve in-progress work and blockers, or record an override reason.");
  }
  if (status === "completed" || status === "delivered") {
    const unverified = await srsDeliveryGate(prisma, id);
    if (unverified.length && !overrideReason) {
      throw validationError(`Mandatory SRS requirements are not verified: ${unverified.slice(0, 8).join(", ")}${unverified.length > 8 ? "…" : ""}. Verify them or record an override reason.`);
    }
    if (unverified.length) await writeAudit(prisma, actor, { action: "srs.delivery_override", entityType: "project", entityId: id, metadata: { unverified, overrideReason } });
  }
  const data =
    status === "archived"
      ? { statusBeforeArchive: project.status, status, archivedAt: new Date(), version: { increment: 1 } }
      : project.status === "archived"
        ? { status, statusBeforeArchive: null, archivedAt: null, version: { increment: 1 } }
        : { status, version: { increment: 1 } };
  const updated = await prisma.project.updateMany({ where: { id, version, organizationId: actor.organizationId }, data });
  if (updated.count !== 1) throw conflict("Someone else updated this project. Reload and try again.");
  await writeAudit(prisma, actor, { action: "project.transition", entityType: "project", entityId: id, before: { status: project.status }, after: { status, overrideReason } });
  await writeActivity(prisma, actor, {
    type: "project.status",
    summary: `${project.name} moved from ${project.status.replaceAll("_", " ")} to ${status.replaceAll("_", " ")}`,
    projectId: id,
    customerId: project.customerId,
    visibility: "customer",
  });
  await refreshProjectHealth(id, actor.timezone);
  scheduleOutbox();
  return { id, status };
}

export async function completeOnboarding(actor: Actor, projectId: string, templateKey: string, note: string) {
  requirePermission(actor, "projects.edit");
  const project = await loadProject(prisma, actor, projectId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  const item = await prisma.onboardingItem.findUnique({ where: { projectId_templateKey: { projectId, templateKey } } });
  if (!item) throw validationError("That onboarding step is not part of this project.");
  if (templateKey === "approve_scope") {
    const [baselined, approvedSrs] = await Promise.all([
      prisma.requirement.count({ where: { projectId, status: "approved", baseline: true } }),
      prisma.srsDocument.count({ where: { projectId, approvedVersionId: { not: null } } }),
    ]);
    if (!baselined && !approvedSrs) throw validationError("Scope is not approved yet. Get the SRS approved by the client, or baseline approved requirements on the Requirements tab, then complete this step.");
  }
  await prisma.onboardingItem.update({
    where: { id: item.id },
    data: { done: true, doneAt: new Date(), doneById: actor.userId, note: cleanText(note, 1000) },
  });
  await writeActivity(prisma, actor, { type: "onboarding.completed", summary: `Completed onboarding step: ${item.label}`, projectId, customerId: project.customerId });
}

export async function addProjectMember(actor: Actor, projectId: string, userId: string, role: string) {
  requirePermission(actor, "projects.assign");
  const project = await loadProject(prisma, actor, projectId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  const user = await prisma.user.findFirst({ where: { id: userId, organizationId: actor.organizationId, kind: "employee", status: "active" } });
  if (!user) throw validationError("Choose an active employee.");
  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId, userId } },
    create: { projectId, userId, role },
    update: { role },
  });
  await notifyUser(prisma, {
    organizationId: actor.organizationId,
    userId,
    type: "project_assignment",
    title: `Added to ${project.name}`,
    body: `${actor.name} added you as ${role}.`,
    href: `/projects/${projectId}`,
    dedupeKey: `member:${projectId}:${userId}:${role}`,
    email: { to: user.email, template: "project_created", payload: { actor: actor.name, project: project.name, customer: "your customer", url: `/projects/${projectId}` } },
  });
  await writeAudit(prisma, actor, { action: "project.assign", entityType: "project", entityId: projectId, after: { userId, role } });
  scheduleOutbox();
}

export async function createMilestone(actor: Actor, projectId: string, input: { name: string; dueOn?: string; ownerId?: string; customerVisible?: boolean; description?: string }) {
  requirePermission(actor, "projects.edit");
  const project = await loadProject(prisma, actor, projectId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  const code = await nextCode(prisma, actor.organizationId, `milestone:${projectId}`, "MS");
  const milestone = await prisma.milestone.create({
    data: {
      organizationId: actor.organizationId,
      projectId,
      code,
      name: cleanText(input.name, 180),
      description: cleanText(input.description ?? "", 4000),
      dueOn: input.dueOn,
      ownerId: input.ownerId,
      customerVisible: input.customerVisible !== false,
    },
  });
  await writeActivity(prisma, actor, { type: "milestone.created", summary: `Added milestone ${milestone.name}`, projectId, customerId: project.customerId, visibility: milestone.customerVisible ? "customer" : "internal" });
  await refreshProjectHealth(projectId, actor.timezone);
  return milestone;
}

export async function transitionMilestone(actor: Actor, id: string, status: string, version: number, overrideReason?: string) {
  requirePermission(actor, "projects.transition");
  const milestone = await prisma.milestone.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!milestone) throw validationError("Milestone not found.");
  const project = await loadProject(prisma, actor, milestone.projectId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  if (status === "completed") {
    const openTasks = await prisma.task.count({ where: { milestoneId: id, status: { notIn: ["done", "cancelled"] } } });
    const openPredecessors = await prisma.milestoneDependency.count({
      where: { successorId: id, predecessor: { status: { not: "completed" } } },
    });
    if ((openTasks || openPredecessors) && !overrideReason) {
      throw validationError("Required milestone work is still open. Record an override reason to complete it anyway.");
    }
    if (overrideReason && !can(actor, "tasks.override")) throw validationError("You cannot override incomplete milestone work.");
  }
  const result = await prisma.milestone.updateMany({
    where: { id, version },
    data: { status, version: { increment: 1 }, completedAt: status === "completed" ? new Date() : null, overrideReason: overrideReason ?? null },
  });
  if (result.count !== 1) throw conflict("Someone else updated this milestone. Reload and try again.");
  await writeAudit(prisma, actor, { action: "milestone.transition", entityType: "milestone", entityId: id, before: { status: milestone.status }, after: { status, overrideReason } });
  await writeActivity(prisma, actor, {
    type: "milestone.status",
    summary: `${milestone.name} is ${status.replaceAll("_", " ")}`,
    projectId: project.id,
    customerId: project.customerId,
    visibility: milestone.customerVisible ? "customer" : "internal",
  });
  await refreshProjectHealth(project.id, actor.timezone);
}

export async function refreshProjectHealth(projectId: string, timeZone: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { manager: { select: { status: true } }, milestones: true, tasks: true, issues: true, changes: true },
  });
  if (!project) return;
  const today = todayInTimeZone(timeZone);
  const overdueMilestones = project.milestones.filter((item) => item.status !== "completed" && item.status !== "cancelled" && item.dueOn && item.dueOn < today).length;
  const overdueTasks = project.tasks.filter((item) => OPEN_TASK.has(item.status) && isPastDate(item.dueOn, timeZone)).length;
  const overdueCriticalTasks = project.tasks.filter((item) => item.priority === "critical" && OPEN_TASK.has(item.status) && isPastDate(item.dueOn, timeZone)).length;
  const blockedTasks = project.tasks.filter((item) => item.status === "blocked").length;
  const openBlockers = project.issues.filter((item) => item.type === "blocker" && item.status === "open").length;
  const dueWithinThreeDays = [...project.milestones, ...project.tasks].filter((item) => {
    const due = "dueOn" in item ? item.dueOn : null;
    const remaining = daysUntil(due, timeZone);
    return remaining != null && remaining >= 0 && remaining <= 3 && !("status" in item && (item.status === "completed" || item.status === "done" || item.status === "cancelled"));
  }).length;
  const openChangeRequests = project.changes.filter((item) => OPEN_CHANGE.has(item.status)).length;
  const scopeChangesAfterBaseline = project.scopeBaselinedAt ? project.changes.length : 0;
  const health = scoreProjectHealth({
    overdueMilestones,
    overdueCriticalTasks,
    overdueTasks,
    blockedTasks,
    openBlockers,
    dueWithinThreeDays,
    openChangeRequests,
    scopeChangesAfterBaseline,
    managerInactive: project.manager?.status === "inactive",
  });
  await prisma.project.update({
    where: { id: projectId },
    data: { healthScore: health.score, healthStatus: health.status, healthReasons: JSON.stringify(health.reasons) },
  });
  return health;
}

export async function createIssue(actor: Actor, projectId: string, input: { type: "risk" | "issue" | "blocker"; title: string; severity?: string; detail?: string; customerVisible?: boolean }) {
  requirePermission(actor, "projects.edit");
  const project = await loadProject(prisma, actor, projectId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  const issue = await prisma.projectIssue.create({
    data: {
      organizationId: actor.organizationId,
      projectId,
      type: input.type,
      title: cleanText(input.title, 180),
      severity: input.severity ?? "medium",
      detail: cleanText(input.detail ?? "", 4000),
      customerVisible: Boolean(input.customerVisible),
      ownerId: actor.userId,
    },
  });
  await refreshProjectHealth(projectId, actor.timezone);
  await writeActivity(prisma, actor, { type: "issue.created", summary: `Logged ${input.type}: ${issue.title}`, projectId, customerId: project.customerId, visibility: issue.customerVisible ? "customer" : "internal" });
  return issue;
}

export async function createMeeting(actor: Actor, projectId: string, input: { title: string; startsAt: string; agenda?: string; notes?: string; visibility?: "internal" | "customer" }) {
  requirePermission(actor, "meetings.manage");
  const project = await loadProject(prisma, actor, projectId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw validationError("Choose a meeting time.", { startsAt: "Choose a valid time." });
  const meeting = await prisma.meeting.create({
    data: {
      organizationId: actor.organizationId,
      projectId,
      customerId: project.customerId,
      title: cleanText(input.title, 180),
      startsAt,
      agenda: cleanText(input.agenda ?? "", 4000),
      notes: cleanText(input.notes ?? "", 8000),
      visibility: input.visibility ?? "internal",
      organizerId: actor.userId,
      participantIds: JSON.stringify([actor.userId]),
    },
  });
  await writeActivity(prisma, actor, { type: "meeting.recorded", summary: `Meeting: ${meeting.title}`, projectId, customerId: project.customerId, visibility: meeting.visibility as "internal" | "customer" });
  return meeting;
}

export async function recordDecision(actor: Actor, projectId: string, input: { title: string; detail: string; visibility?: "internal" | "customer"; decidedOn: string }) {
  requirePermission(actor, "decisions.manage");
  const project = await loadProject(prisma, actor, projectId);
  const decision = await prisma.decision.create({
    data: {
      organizationId: actor.organizationId,
      projectId,
      title: cleanText(input.title, 180),
      detail: cleanText(input.detail, 8000),
      visibility: input.visibility ?? "internal",
      decidedOn: input.decidedOn,
      authorId: actor.userId,
      authorName: actor.name,
    },
  });
  await writeActivity(prisma, actor, { type: "decision.recorded", summary: `Decision: ${decision.title}`, projectId, customerId: project.customerId, visibility: decision.visibility as "internal" | "customer" });
  return decision;
}

function presentProject(project: {
  id: string;
  code: string;
  name: string;
  status: string;
  priority: string;
  healthScore: number;
  healthStatus: string;
  healthReasons: string;
  dueOn: string | null;
  startOn: string | null;
  budgetCents: number | null;
  currency: string;
  archivedAt: Date | null;
  scopeBaselinedAt: Date | null;
  customerId: string;
  summary: string;
  version: number;
  customer?: { id: string; name: string; code: string };
  manager?: { id: string; name: string; status: string } | null;
}) {
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    status: project.status,
    priority: project.priority,
    healthScore: project.healthScore,
    healthStatus: project.healthStatus,
    healthReasons: JSON.parse(project.healthReasons) as string[],
    dueOn: project.dueOn,
    startOn: project.startOn,
    budgetCents: project.budgetCents,
    currency: project.currency,
    archivedAt: project.archivedAt,
    scopeBaselinedAt: project.scopeBaselinedAt,
    customerId: project.customerId,
    summary: project.summary,
    version: project.version,
    customer: project.customer,
    manager: project.manager,
  };
}

export { requireEmployee };
