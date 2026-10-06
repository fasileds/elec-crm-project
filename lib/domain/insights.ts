import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { can, requireEmployee, requirePermission } from "@/lib/actor";
import { customerListScope, projectListScope } from "@/lib/domain/access";
import { arrangeWidgets, lensFor, moveWidget, widgetsFor } from "@/lib/domain/dashboard-layout";
import { daysUntil, todayInTimeZone } from "@/lib/dates";
import { OPEN_CHANGE, OPEN_TASK } from "@/lib/domain/workflow";
import { writeAudit } from "@/lib/domain/support";
import { forbidden } from "@/lib/errors";

const OPEN_LEAD = ["new", "contacted", "qualified"];

export async function dashboard(actor: Actor, rangeDays = 30) {
  requireEmployee(actor);
  const today = todayInTimeZone(actor.timezone);
  const horizon = addDays(today, 3);
  const range = clampRange(rangeDays);
  const since = new Date(Date.now() - range * 86_400_000);
  const projectWhere = { organizationId: actor.organizationId, archivedAt: null, ...projectListScope(actor) };
  const seePipeline = can(actor, "leads.view");
  const seeApprovals = can(actor, "approvals.decide");
  const seeWorkload = can(actor, "employees.view") || can(actor, "reports.view");
  const seeFinance = can(actor, "finance.view");
  const seeCustomers = can(actor, "customers.view");

  const [projects, tasks, leads, approvalCount, approvalRows, activities, messageCount, messages, reminders, milestones, issues, changes, taskMix, notifications, inactiveCustomers, newLeads, budgets, workloadGroups, layoutRow] = await Promise.all([
    prisma.project.findMany({
      where: projectWhere,
      select: { id: true, name: true, code: true, status: true, healthStatus: true, healthScore: true, healthReasons: true, dueOn: true, budgetCents: true, customer: { select: { id: true, name: true } } },
    }),
    prisma.task.findMany({
      where: { organizationId: actor.organizationId, project: projectWhere, status: { in: [...OPEN_TASK] } },
      select: { id: true, title: true, code: true, status: true, priority: true, dueOn: true, projectId: true, assigneeId: true, project: { select: { name: true } } },
    }),
    seePipeline ? prisma.lead.count({ where: { organizationId: actor.organizationId, status: { in: OPEN_LEAD }, archivedAt: null } }) : Promise.resolve(0),
    seeApprovals ? prisma.approval.count({ where: { organizationId: actor.organizationId, status: "pending" } }) : Promise.resolve(0),
    seeApprovals
      ? prisma.approval.findMany({
          where: { organizationId: actor.organizationId, status: "pending" },
          orderBy: { createdAt: "asc" },
          take: 8,
          select: { id: true, entityType: true, createdAt: true, projectId: true, project: { select: { name: true, code: true } } },
        })
      : Promise.resolve([]),
    prisma.activity.findMany({
      where: { organizationId: actor.organizationId, createdAt: { gte: since }, ...(actor.kind === "customer" ? { visibility: "customer" } : {}) },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, summary: true, actorName: true, type: true, createdAt: true, projectId: true, customerId: true, visibility: true },
    }),
    prisma.comment.count({ where: { organizationId: actor.organizationId, visibility: "customer", deletedAt: null, createdAt: { gte: since }, project: projectWhere } }),
    prisma.comment.findMany({
      where: { organizationId: actor.organizationId, visibility: "customer", deletedAt: null, createdAt: { gte: since }, project: projectWhere },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, body: true, authorName: true, createdAt: true, projectId: true, project: { select: { name: true } } },
    }),
    prisma.reminder.findMany({
      where: { organizationId: actor.organizationId, assigneeId: actor.userId, status: "open" },
      orderBy: { dueAt: "asc" },
      take: 6,
      select: { id: true, note: true, dueAt: true, leadId: true, customerId: true, projectId: true },
    }),
    prisma.milestone.findMany({
      where: { organizationId: actor.organizationId, status: { notIn: ["completed", "cancelled"] }, project: projectWhere },
      orderBy: { dueOn: "asc" },
      take: 8,
      select: { id: true, name: true, dueOn: true, status: true, projectId: true, project: { select: { name: true, code: true } } },
    }),
    prisma.projectIssue.findMany({
      where: { organizationId: actor.organizationId, status: "open", project: projectWhere },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, title: true, severity: true, type: true, projectId: true, project: { select: { name: true } } },
    }),
    prisma.changeRequest.count({ where: { organizationId: actor.organizationId, status: { in: [...OPEN_CHANGE] }, project: projectWhere } }),
    prisma.task.groupBy({ by: ["status"], where: { organizationId: actor.organizationId, project: projectWhere }, _count: { _all: true } }),
    prisma.notification.findMany({
      where: { userId: actor.userId, readAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, title: true, body: true, href: true, type: true, createdAt: true },
    }),
    seeCustomers ? prisma.customer.count({ where: { organizationId: actor.organizationId, status: "inactive", archivedAt: null, ...customerListScope(actor) } }) : Promise.resolve(0),
    seePipeline ? prisma.lead.count({ where: { organizationId: actor.organizationId, createdAt: { gte: since }, archivedAt: null } }) : Promise.resolve(0),
    seeFinance
      ? prisma.project.aggregate({ where: { ...projectWhere, budgetCents: { not: null } }, _sum: { budgetCents: true }, _count: { _all: true } })
      : Promise.resolve(null),
    seeWorkload
      ? prisma.task.groupBy({
          by: ["assigneeId"],
          where: { organizationId: actor.organizationId, status: { in: [...OPEN_TASK] }, assigneeId: { not: null }, project: projectWhere },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    prisma.savedView.findFirst({
      where: { userId: actor.userId, organizationId: actor.organizationId, entityType: "dashboard", name: "layout" },
      orderBy: { createdAt: "desc" },
      select: { query: true },
    }),
  ]);

  const pipeline = seePipeline
    ? await prisma.lead.groupBy({ by: ["status"], where: { organizationId: actor.organizationId, archivedAt: null }, _count: { _all: true } })
    : [];
  const assigneeIds = workloadGroups.map((row) => row.assigneeId).filter((id): id is string => Boolean(id));
  const assignees = assigneeIds.length
    ? await prisma.user.findMany({ where: { organizationId: actor.organizationId, id: { in: assigneeIds } }, select: { id: true, name: true, status: true } })
    : [];
  const assigneeName = new Map(assignees.map((person) => [person.id, person]));

  const overdueTasks = tasks.filter((task) => task.dueOn && task.dueOn < today);
  const blocked = tasks.filter((task) => task.status === "blocked");
  const dueToday = tasks.filter((task) => task.dueOn === today);
  const atRisk = projects.filter((project) => project.healthStatus === "at_risk" || project.healthStatus === "critical");
  const mine = tasks
    .filter((task) => task.assigneeId === actor.userId)
    .sort((a, b) => rankDue(a.dueOn, today) - rankDue(b.dueOn, today) || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
  const healthMix = {
    healthy: projects.filter((project) => project.healthStatus === "healthy").length,
    watch: projects.filter((project) => project.healthStatus === "watch").length,
    at_risk: projects.filter((project) => project.healthStatus === "at_risk").length,
    critical: projects.filter((project) => project.healthStatus === "critical").length,
  };
  const lens = lensFor(actor.permissions);
  let saved: string[] | null = null;
  if (layoutRow?.query) {
    try {
      const parsed = JSON.parse(layoutRow.query) as unknown;
      saved = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : null;
    } catch {
      saved = null;
    }
  }

  return {
    lens,
    rangeDays: range,
    today,
    widgets: arrangeWidgets(saved, widgetsFor(actor.permissions)),
    counts: {
      activeProjects: projects.filter((project) => project.status === "active").length,
      atRisk: atRisk.length,
      critical: healthMix.critical,
      overdueTasks: overdueTasks.length,
      blocked: blocked.length,
      openLeads: leads,
      pendingApprovals: approvalCount,
      dueToday: dueToday.length,
      customerMessages: messageCount,
      openChanges: changes,
      inactiveCustomers,
      newLeads,
      myOpen: mine.length,
    },
    atRisk: atRisk
      .sort((a, b) => a.healthScore - b.healthScore)
      .slice(0, 6)
      .map((project) => ({ ...project, healthReasons: parseReasons(project.healthReasons) })),
    healthMix,
    overdue: overdueTasks.slice(0, 8),
    upcoming: tasks.filter((task) => task.dueOn && task.dueOn >= today).sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? "")).slice(0, 8),
    mine: mine.slice(0, 8),
    pipeline,
    activities,
    approvals: approvalRows,
    messages,
    reminders,
    milestones: milestones.map((milestone) => ({ ...milestone, days: daysUntil(milestone.dueOn, actor.timezone) })),
    issues,
    notifications,
    taskMix,
    workload: workloadGroups
      .map((row) => {
        const person = row.assigneeId ? assigneeName.get(row.assigneeId) : undefined;
        return { id: row.assigneeId ?? "unassigned", name: person?.name ?? "Unassigned", inactive: person?.status === "inactive", tasks: row._count._all };
      })
      .sort((a, b) => b.tasks - a.tasks)
      .slice(0, 8),
    commercial: budgets ? { budgetCents: budgets._sum.budgetCents ?? 0, projects: budgets._count._all, currency: actor.currency } : null,
    attention: buildAttention({ today, horizon, actorId: actor.userId, overdue: overdueTasks, blocked, dueToday, approvals: approvalRows, messages, reminders, notifications }),
  };
}

function buildAttention(input: {
  today: string;
  horizon: string;
  actorId: string;
  overdue: Array<{ id: string; title: string; dueOn: string | null; projectId: string; assigneeId: string | null; project: { name: string } }>;
  blocked: Array<{ id: string; title: string; projectId: string; assigneeId: string | null; project: { name: string } }>;
  dueToday: Array<{ id: string; title: string; projectId: string; assigneeId: string | null; project: { name: string } }>;
  approvals: Array<{ id: string; entityType: string; projectId: string | null; project: { name: string; code: string } | null }>;
  messages: Array<{ id: string; authorName: string; projectId: string | null; project: { name: string } | null; body: string }>;
  reminders: Array<{ id: string; note: string; dueAt: Date; leadId: string | null; customerId: string | null; projectId: string | null }>;
  notifications: Array<{ id: string; title: string; href: string; type: string }>;
}) {
  const items: Array<{ id: string; severity: "now" | "soon" | "info"; title: string; detail: string; href: string }> = [];
  for (const task of input.overdue.filter((task) => task.assigneeId === input.actorId).slice(0, 4)) {
    items.push({ id: `task-${task.id}`, severity: "now", title: task.title, detail: `Overdue on ${task.project.name}`, href: `/projects/${task.projectId}` });
  }
  for (const task of input.blocked.filter((task) => task.assigneeId === input.actorId).slice(0, 3)) {
    items.push({ id: `blocked-${task.id}`, severity: "now", title: task.title, detail: `Blocked on ${task.project.name}`, href: `/projects/${task.projectId}?tab=work` });
  }
  for (const approval of input.approvals.slice(0, 3)) {
    items.push({
      id: `approval-${approval.id}`,
      severity: "now",
      title: `${approval.entityType.replaceAll("_", " ")} needs a decision`,
      detail: approval.project ? `${approval.project.code} · ${approval.project.name}` : "Pending approval",
      href: "/approvals",
    });
  }
  for (const task of input.dueToday.filter((task) => task.assigneeId === input.actorId).slice(0, 3)) {
    items.push({ id: `today-${task.id}`, severity: "soon", title: task.title, detail: `Due today on ${task.project.name}`, href: `/projects/${task.projectId}?tab=work` });
  }
  for (const reminder of input.reminders.slice(0, 3)) {
    const due = reminder.dueAt.toISOString().slice(0, 10);
    const href = reminder.leadId ? "/leads" : reminder.customerId ? `/customers/${reminder.customerId}` : reminder.projectId ? `/projects/${reminder.projectId}` : "/dashboard";
    items.push({ id: `reminder-${reminder.id}`, severity: due < input.today ? "now" : due <= input.horizon ? "soon" : "info", title: reminder.note, detail: due < input.today ? "Follow-up is overdue" : "Follow-up", href });
  }
  for (const message of input.messages.slice(0, 3)) {
    items.push({
      id: `message-${message.id}`,
      severity: "info",
      title: `${message.authorName} wrote to the project`,
      detail: message.project?.name ?? excerpt(message.body),
      href: message.projectId ? `/projects/${message.projectId}?tab=discussion` : "/notifications",
    });
  }
  for (const note of input.notifications.slice(0, 3)) {
    items.push({ id: `note-${note.id}`, severity: note.type === "mention" ? "soon" : "info", title: note.title, detail: note.type.replaceAll("_", " "), href: note.href || "/notifications" });
  }
  const rank = { now: 0, soon: 1, info: 2 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 8);
}

export async function saveDashboardLayout(actor: Actor, order: string[]) {
  requireEmployee(actor);
  const next = arrangeWidgets(order, widgetsFor(actor.permissions));
  const existing = await prisma.savedView.findFirst({
    where: { userId: actor.userId, organizationId: actor.organizationId, entityType: "dashboard", name: "layout" },
  });
  if (existing) {
    await prisma.savedView.update({ where: { id: existing.id }, data: { query: JSON.stringify(next) } });
  } else {
    await prisma.savedView.create({
      data: { organizationId: actor.organizationId, userId: actor.userId, entityType: "dashboard", name: "layout", query: JSON.stringify(next) },
    });
  }
  return next;
}

export function nextDashboardOrder(order: string, widget: string, direction: "up" | "down") {
  return moveWidget(order.split(",").filter(Boolean), widget, direction);
}

function parseReasons(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function clampRange(days: number) {
  if (days === 7 || days === 90) return days;
  return 30;
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function rankDue(dueOn: string | null, today: string) {
  if (!dueOn) return 2;
  if (dueOn < today) return 0;
  if (dueOn === today) return 1;
  return 2;
}

function excerpt(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

export async function searchAll(actor: Actor, q: string) {
  const term = q.trim().toLowerCase();
  if (term.length < 2) return { customers: [], contacts: [], projects: [], tasks: [], requirements: [], documents: [], people: [] };
  const customerScope = customerListScope(actor);
  const projects = actor.permissions.includes("projects.view") || actor.kind === "customer"
    ? { organizationId: actor.organizationId, ...projectListScope(actor) }
    : { organizationId: actor.organizationId, ...projectListScope(actor) };
  const [customers, contacts, projectRows, tasks, requirements, documents, people] = await Promise.all([
    actor.kind === "employee"
      ? prisma.customer.findMany({ where: { organizationId: actor.organizationId, ...customerScope, searchText: { contains: term } }, take: 8, select: { id: true, name: true, code: true, status: true } })
      : Promise.resolve([]),
    prisma.contact.findMany({
      where: { organizationId: actor.organizationId, archivedAt: null, searchText: { contains: term }, ...(actor.kind === "customer" ? { customerId: actor.customerId ?? "__none__" } : {}) },
      take: 8,
      select: { id: true, name: true, email: true, customerId: true },
    }),
    prisma.project.findMany({ where: { ...projects, searchText: { contains: term } }, take: 8, select: { id: true, name: true, code: true, status: true } }),
    prisma.task.findMany({
      where: { organizationId: actor.organizationId, searchText: { contains: term }, ...(actor.kind === "customer" ? { customerVisible: true, project: { customerId: actor.customerId ?? "__none__" } } : { project: projectListScope(actor) }) },
      take: 8,
      select: { id: true, title: true, code: true, projectId: true, status: true },
    }),
    prisma.requirement.findMany({
      where: { organizationId: actor.organizationId, searchText: { contains: term }, ...(actor.kind === "customer" ? { customerVisible: true, project: { customerId: actor.customerId ?? "__none__" } } : {}) },
      take: 8,
      select: { id: true, title: true, code: true, projectId: true, status: true },
    }),
    prisma.document.findMany({
      where: { organizationId: actor.organizationId, fileName: { contains: term }, ...(actor.kind === "customer" ? { visibility: "customer", customerId: actor.customerId ?? "__none__" } : {}) },
      take: 8,
      select: { id: true, fileName: true, projectId: true, visibility: true },
    }),
    actor.kind === "employee" && can(actor, "employees.view")
      ? prisma.user.findMany({ where: { organizationId: actor.organizationId, kind: "employee", OR: [{ name: { contains: term } }, { email: { contains: term } }] }, take: 8, select: { id: true, name: true, email: true, jobTitle: true } })
      : Promise.resolve([]),
  ]);
  return { customers, contacts, projects: projectRows, tasks, requirements, documents, people };
}

export async function exportRows(actor: Actor, type: "customers" | "projects" | "tasks" | "time") {
  requirePermission(actor, "exports.create");
  if (actor.kind === "customer") throw forbidden("Customers cannot export internal records.");
  const rows = await rowsFor(actor, type);
  await prisma.exportJob.create({
    data: { organizationId: actor.organizationId, requestedById: actor.userId, type, status: rows.length > 5000 ? "failed" : "ready", rowCount: Math.min(rows.length, 5000), error: rows.length > 5000 ? "Narrow the filters. Exports are limited to 5000 rows." : null, finishedAt: new Date() },
  });
  if (rows.length > 5000) throw forbidden("Narrow the filters. Exports are limited to 5000 rows.");
  await writeAudit(prisma, actor, { action: "export.create", entityType: type, entityId: actor.organizationId, metadata: { rows: rows.length } });
  return toCsv(rows.slice(0, 5000));
}

async function rowsFor(actor: Actor, type: "customers" | "projects" | "tasks" | "time") {
  if (type === "customers") {
    requirePermission(actor, "customers.export");
    const customers = await prisma.customer.findMany({ where: { organizationId: actor.organizationId, ...customerListScope(actor) }, take: 5001 });
    return customers.map((customer) => ({ code: customer.code, name: customer.name, status: customer.status, industry: customer.industry ?? "", source: customer.source ?? "" }));
  }
  if (type === "projects") {
    const projects = await prisma.project.findMany({ where: { organizationId: actor.organizationId, ...projectListScope(actor) }, include: { customer: true }, take: 5001 });
    return projects.map((project) => ({ code: project.code, name: project.name, customer: project.customer.name, status: project.status, health: project.healthStatus, due: project.dueOn ?? "" }));
  }
  if (type === "tasks") {
    const tasks = await prisma.task.findMany({ where: { organizationId: actor.organizationId, project: projectListScope(actor) }, take: 5001 });
    return tasks.map((task) => ({ code: task.code, title: task.title, status: task.status, priority: task.priority, due: task.dueOn ?? "" }));
  }
  requirePermission(actor, "time.view");
  const entries = await prisma.timeEntry.findMany({ where: { organizationId: actor.organizationId }, include: { user: true, project: true }, take: 5001 });
  return entries.map((entry) => ({ person: entry.user.name, project: entry.project.code, date: entry.workOn, minutes: String(entry.minutes), status: entry.status }));
}

function toCsv(rows: Array<Record<string, string>>) {
  if (!rows.length) return "empty\n";
  const headers = Object.keys(rows[0]!);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => `"${String(row[header] ?? "").replaceAll('"', '""')}"`).join(","));
  }
  return lines.join("\n");
}

export async function listNotifications(actor: Actor) {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: actor.userId }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.notification.count({ where: { userId: actor.userId, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markNotificationRead(actor: Actor, id: string) {
  await prisma.notification.updateMany({ where: { id, userId: actor.userId, readAt: null }, data: { readAt: new Date() } });
}

export async function markAllNotificationsRead(actor: Actor) {
  await prisma.notification.updateMany({ where: { userId: actor.userId, readAt: null }, data: { readAt: new Date() } });
}

export async function updatePreference(actor: Actor, eventType: string, inApp: boolean, email: boolean) {
  await prisma.notificationPreference.upsert({
    where: { userId_eventType: { userId: actor.userId, eventType } },
    create: { organizationId: actor.organizationId, userId: actor.userId, eventType, inApp, email },
    update: { inApp, email },
  });
}

export async function listLookups(actor: Actor, kind?: string) {
  requireEmployee(actor);
  return prisma.lookupOption.findMany({
    where: { organizationId: actor.organizationId, ...(kind ? { kind } : {}) },
    orderBy: [{ kind: "asc" }, { sort: "asc" }],
  });
}

export async function updateLookup(actor: Actor, id: string, input: { label?: string; enabled?: boolean }) {
  requirePermission(actor, "settings.manage");
  const option = await prisma.lookupOption.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!option) throw forbidden("Setting not found.");
  const { LOCKED_LOOKUP_KEYS } = await import("@/lib/domain/bootstrap");
  if (input.enabled === false && LOCKED_LOOKUP_KEYS.has(`${option.kind}:${option.key}`)) {
    throw forbidden("This option is required by the workflow and cannot be disabled.");
  }
  await prisma.lookupOption.update({ where: { id }, data: { label: input.label ?? option.label, enabled: input.enabled ?? option.enabled } });
  await writeAudit(prisma, actor, { action: "settings.lookup", entityType: "lookup", entityId: id, before: { label: option.label, enabled: option.enabled }, after: input });
}

export async function listAudit(actor: Actor, page = 1) {
  requirePermission(actor, "audit.view");
  const where = { organizationId: actor.organizationId };
  const [total, items] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 40, take: 40 }),
  ]);
  return { items, page, pageSize: 40, total };
}

export async function listEmails(actor: Actor) {
  requirePermission(actor, "settings.manage");
  return prisma.emailMessage.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, toEmail: true, template: true, status: true, attempts: true, lastError: true, createdAt: true, sentAt: true },
  });
}

export async function portalHome(actor: Actor) {
  if (actor.kind !== "customer" || !actor.customerId) throw forbidden();
  const today = todayInTimeZone(actor.timezone);
  const customerId = actor.customerId;
  const [customer, projects, approvals, announcements, activities, milestones, documents, tasks] = await Promise.all([
    prisma.customer.findFirst({ where: { id: customerId, organizationId: actor.organizationId } }),
    prisma.project.findMany({
      where: { customerId, organizationId: actor.organizationId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, code: true, status: true, summary: true, dueOn: true },
    }),
    prisma.approval.findMany({
      where: { organizationId: actor.organizationId, status: "pending", project: { customerId } },
      orderBy: { createdAt: "asc" },
      take: 8,
      select: { id: true, entityType: true, projectId: true, project: { select: { name: true, code: true } } },
    }),
    prisma.announcement.findMany({
      where: { organizationId: actor.organizationId, OR: [{ customerId: null }, { customerId }] },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
    prisma.activity.findMany({
      where: { customerId, organizationId: actor.organizationId, visibility: "customer" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, summary: true, actorName: true, type: true, createdAt: true, projectId: true },
    }),
    prisma.milestone.findMany({
      where: { organizationId: actor.organizationId, customerVisible: true, status: { notIn: ["completed", "cancelled"] }, project: { customerId, archivedAt: null } },
      orderBy: { dueOn: "asc" },
      take: 6,
      select: { id: true, name: true, dueOn: true, status: true, projectId: true, project: { select: { name: true } } },
    }),
    prisma.document.findMany({
      where: { organizationId: actor.organizationId, customerId, visibility: "customer", archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, fileName: true, createdAt: true, projectId: true },
    }),
    prisma.task.findMany({
      where: { organizationId: actor.organizationId, customerVisible: true, status: { in: [...OPEN_TASK] }, project: { customerId, archivedAt: null } },
      orderBy: { dueOn: "asc" },
      take: 6,
      select: { id: true, title: true, dueOn: true, status: true, projectId: true, project: { select: { name: true } } },
    }),
  ]);
  const progress = await prisma.milestone.groupBy({
    by: ["projectId", "status"],
    where: { organizationId: actor.organizationId, customerVisible: true, project: { customerId, archivedAt: null } },
    _count: { _all: true },
  });
  return {
    customer,
    projects: projects.map((project) => {
      const rows = progress.filter((row) => row.projectId === project.id);
      const total = rows.reduce((sum, row) => sum + row._count._all, 0);
      const completed = rows.filter((row) => row.status === "completed").reduce((sum, row) => sum + row._count._all, 0);
      return { ...project, milestoneTotal: total, milestoneDone: completed };
    }),
    approvals,
    announcements,
    activities,
    milestones: milestones.map((milestone) => ({ ...milestone, overdue: Boolean(milestone.dueOn && milestone.dueOn < today) })),
    documents,
    tasks,
    waiting: approvals.length,
  };
}
