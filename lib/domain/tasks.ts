import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { can, requirePermission } from "@/lib/actor";
import { loadProject, projectListScope } from "@/lib/domain/access";
import { refreshProjectHealth } from "@/lib/domain/projects";
import {
  assertEnabledLookup,
  nextCode,
  notifyUser,
  type Db,
  rememberIdempotency,
  replayOrClaim,
  scheduleOutbox,
  writeActivity,
  writeAudit,
} from "@/lib/domain/support";
import { OPEN_TASK, TASK_TRANSITIONS, canTransition } from "@/lib/domain/workflow";
import { isPastDate } from "@/lib/dates";
import { conflict, validationError } from "@/lib/errors";
import { cleanText, searchBlob } from "@/lib/text";

const PAGE = 30;

export async function listTasks(actor: Actor, query: { page?: number; q?: string; status?: string; assigneeId?: string; projectId?: string; overdue?: boolean }) {
  const page = Math.max(1, query.page ?? 1);
  const q = query.q?.trim().toLowerCase();
  const where = {
    organizationId: actor.organizationId,
    project: projectListScope(actor),
    ...(actor.kind === "customer" ? { customerVisible: true } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(q ? { searchText: { contains: q } } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: [{ dueOn: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { project: { select: { id: true, name: true, code: true } }, assignee: { select: { id: true, name: true, status: true } } },
    }),
  ]);
  const items = rows
    .filter((task) => (query.overdue ? OPEN_TASK.has(task.status) && isPastDate(task.dueOn, actor.timezone) : true))
    .map((task) => ({
      ...present(task),
      overdue: OPEN_TASK.has(task.status) && isPastDate(task.dueOn, actor.timezone),
      project: task.project,
      assignee: task.assignee ? { id: task.assignee.id, name: task.assignee.name, inactive: task.assignee.status !== "active" } : null,
    }));
  return { items, page, pageSize: PAGE, total };
}

export async function createTask(
  actor: Actor,
  input: {
    projectId: string;
    title: string;
    description?: string;
    priority?: string;
    assigneeId?: string | null;
    teamId?: string | null;
    parentId?: string | null;
    milestoneId?: string | null;
    requirementId?: string | null;
    dueOn?: string | null;
    estimatedMinutes?: number;
    customerVisible?: boolean;
    recurrence?: string;
    idempotencyKey?: string | null;
  },
) {
  requirePermission(actor, "tasks.create");
  const project = await loadProject(prisma, actor, input.projectId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  const title = cleanText(input.title, 180);
  if (title.length < 2) throw validationError("Enter a task title.", { title: "Enter a task title." });
  if (input.priority) await assertEnabledLookup(prisma, actor.organizationId, "priority", input.priority);
  const result = await prisma.$transaction(async (tx) => {
    const replay = await replayOrClaim(tx, actor, input.idempotencyKey, "task");
    if (replay) return { id: replay, replayed: true };
    const code = await nextCode(tx, actor.organizationId, `task:${project.id}`, "TSK");
    const task = await tx.task.create({
      data: {
        organizationId: actor.organizationId,
        projectId: project.id,
        code,
        title,
        description: cleanText(input.description ?? "", 8000),
        priority: input.priority ?? "medium",
        assigneeId: input.assigneeId,
        teamId: input.teamId,
        parentId: input.parentId,
        milestoneId: input.milestoneId,
        requirementId: input.requirementId,
        dueOn: input.dueOn,
        estimatedMinutes: Math.max(0, input.estimatedMinutes ?? 0),
        customerVisible: Boolean(input.customerVisible),
        recurrence: input.recurrence ?? "none",
        createdById: actor.userId,
        searchText: searchBlob([title, code, project.name, input.description]),
      },
    });
    await writeAudit(tx, actor, { action: "task.create", entityType: "task", entityId: task.id, after: { title, projectId: project.id } });
    await writeActivity(tx, actor, { type: "task.created", summary: `Created task ${title}`, projectId: project.id, customerId: project.customerId, visibility: task.customerVisible ? "customer" : "internal" });
    if (input.assigneeId) await notifyAssignment(tx, actor, task.id, input.assigneeId, title, project.name, project.id, input.dueOn);
    await rememberIdempotency(tx, actor, input.idempotencyKey, "task", task.id);
    return { id: task.id, replayed: false };
  });
  scheduleOutbox();
  await refreshProjectHealth(project.id, actor.timezone);
  return result;
}

export async function transitionTask(actor: Actor, id: string, status: string, version: number, overrideReason?: string) {
  requirePermission(actor, "tasks.edit");
  const task = await prisma.task.findFirst({ where: { id, organizationId: actor.organizationId }, include: { project: true } });
  if (!task) throw validationError("Task not found.");
  await loadProject(prisma, actor, task.projectId);
  if (task.project.archivedAt) throw conflict("Archived projects are read-only.");
  if (actor.kind === "customer") throw validationError("Customers cannot change task status.");
  await assertEnabledLookup(prisma, actor.organizationId, "task_status", status);
  if (!canTransition(TASK_TRANSITIONS, task.status, status)) throw validationError(`Cannot move this task from ${task.status} to ${status}.`);
  if (status === "done") {
    const [openChildren, openPredecessors] = await Promise.all([
      prisma.task.count({ where: { parentId: id, status: { notIn: ["done", "cancelled"] } } }),
      prisma.taskDependency.count({ where: { successorId: id, predecessor: { status: { notIn: ["done", "cancelled"] } } } }),
    ]);
    if ((openChildren || openPredecessors) && !overrideReason) {
      throw validationError("Dependent work is still open. An authorized override with an explanation is required.");
    }
    if (overrideReason && !can(actor, "tasks.override")) {
      throw validationError("You do not have permission to override unfinished dependencies.");
    }
  }
  const result = await prisma.task.updateMany({
    where: { id, version },
    data: {
      status,
      version: { increment: 1 },
      completedAt: status === "done" ? new Date() : null,
      overrideReason: overrideReason ?? null,
      blockedReason: status === "blocked" ? overrideReason || task.blockedReason : null,
      abandonedAt: status === "cancelled" ? new Date() : null,
    },
  });
  if (result.count !== 1) throw conflict("Someone else updated this task. Reload and try again.");
  if (status === "done" && task.recurrence !== "none" && task.dueOn) {
    const nextDue = shiftDate(task.dueOn, task.recurrence);
    await createTask(actor, {
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      priority: task.priority,
      assigneeId: task.assigneeId,
      teamId: task.teamId,
      milestoneId: task.milestoneId,
      requirementId: task.requirementId,
      dueOn: nextDue,
      estimatedMinutes: task.estimatedMinutes,
      customerVisible: task.customerVisible,
      recurrence: task.recurrence,
      idempotencyKey: `recur:${task.id}:${nextDue}`,
    });
  }
  await writeAudit(prisma, actor, { action: "task.transition", entityType: "task", entityId: id, before: { status: task.status }, after: { status, overrideReason } });
  await writeActivity(prisma, actor, { type: "task.status", summary: `${task.title} is ${status.replaceAll("_", " ")}`, projectId: task.projectId, customerId: task.project.customerId, visibility: task.customerVisible ? "customer" : "internal" });
  await refreshProjectHealth(task.projectId, actor.timezone);
}

export async function assignTask(actor: Actor, id: string, assigneeId: string | null, version: number) {
  requirePermission(actor, "tasks.assign");
  const task = await prisma.task.findFirst({ where: { id, organizationId: actor.organizationId }, include: { project: true } });
  if (!task) throw validationError("Task not found.");
  if (task.project.archivedAt) throw conflict("Archived projects are read-only.");
  if (assigneeId) {
    const user = await prisma.user.findFirst({ where: { id: assigneeId, organizationId: actor.organizationId, status: "active", kind: "employee" } });
    if (!user) throw validationError("Choose an active employee. Inactive people cannot receive new work.");
  }
  const result = await prisma.task.updateMany({ where: { id, version }, data: { assigneeId, version: { increment: 1 } } });
  if (result.count !== 1) throw conflict("Someone else updated this task. Reload and try again.");
  if (assigneeId) await notifyAssignment(prisma, actor, id, assigneeId, task.title, task.project.name, task.projectId, task.dueOn);
  await writeAudit(prisma, actor, { action: "task.assign", entityType: "task", entityId: id, before: { assigneeId: task.assigneeId }, after: { assigneeId } });
  scheduleOutbox();
}

export async function addTaskDependency(actor: Actor, successorId: string, predecessorId: string) {
  requirePermission(actor, "tasks.edit");
  if (successorId === predecessorId) throw validationError("A task cannot depend on itself.");
  const [successor, predecessor] = await Promise.all([
    prisma.task.findFirst({ where: { id: successorId, organizationId: actor.organizationId } }),
    prisma.task.findFirst({ where: { id: predecessorId, organizationId: actor.organizationId } }),
  ]);
  if (!successor || !predecessor || successor.projectId !== predecessor.projectId) throw validationError("Dependencies must stay inside the same project.");
  const project = await loadProject(prisma, actor, successor.projectId);
  if (project.archivedAt) throw conflict("Archived projects are read-only.");
  if (await createsCycle(predecessorId, successorId)) throw validationError("That dependency would create a cycle.");
  await prisma.taskDependency.create({ data: { predecessorId, successorId } });
  await writeAudit(prisma, actor, { action: "task.dependency", entityType: "task", entityId: successorId, after: { predecessorId } });
}

async function createsCycle(predecessorId: string, successorId: string) {
  const seen = new Set<string>();
  const stack = [predecessorId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === successorId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const links = await prisma.taskDependency.findMany({ where: { successorId: current }, select: { predecessorId: true } });
    stack.push(...links.map((link) => link.predecessorId));
  }
  return false;
}

async function notifyAssignment(db: Db, actor: Actor, taskId: string, assigneeId: string, title: string, projectName: string, projectId: string, dueOn?: string | null) {
  if (assigneeId === actor.userId) return;
  const user = await db.user.findUnique({ where: { id: assigneeId } });
  if (!user || user.status !== "active") return;
  await notifyUser(db, {
    organizationId: actor.organizationId,
    userId: user.id,
    type: "task_assigned",
    title: `Assigned: ${title}`,
    body: `${actor.name} assigned you work on ${projectName}.`,
    href: `/projects/${projectId}`,
    dedupeKey: `task-assign:${taskId}:${user.id}`,
    email: { to: user.email, template: "task_assigned", payload: { actor: actor.name, task: title, project: projectName, due: dueOn || "unscheduled", url: `/projects/${projectId}` } },
  });
}

function shiftDate(dueOn: string, recurrence: string) {
  const date = new Date(`${dueOn}T00:00:00Z`);
  if (recurrence === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else if (recurrence === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  else date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function present(task: { id: string; code: string; title: string; status: string; priority: string; dueOn: string | null; estimatedMinutes: number; customerVisible: boolean; version: number; projectId: string; blockedReason: string | null }) {
  return {
    id: task.id,
    code: task.code,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueOn: task.dueOn,
    estimatedMinutes: task.estimatedMinutes,
    customerVisible: task.customerVisible,
    version: task.version,
    projectId: task.projectId,
    blockedReason: task.blockedReason,
  };
}
