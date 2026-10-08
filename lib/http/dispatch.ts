import { AppError, validationError } from "@/lib/errors";
import { actorFromToken, acceptInvitation, confirmPassword, loginWithPassword, logout, requestPasswordReset, resetPassword, revokeInvitation, verifyEmail, createInvitation } from "@/lib/domain/auth";
import { addContact, archiveCustomer, createCustomer, findDuplicates, getCustomer, listCustomers, mergeCustomers } from "@/lib/domain/customers";
import { addReminder, assignLeads, convertLead, createLead, getOpportunity, listLeads, listOpportunities, mergeLeads, transitionLead, transitionOpportunity } from "@/lib/domain/leads";
import { addProjectMember, completeOnboarding, createIssue, createMilestone, createProject, getProject, listProjects, recordDecision, transitionMilestone, transitionProject } from "@/lib/domain/projects";
import { addTaskDependency, assignTask, createTask, listTasks, transitionTask } from "@/lib/domain/tasks";
import { baselineScope, createRequirement, decideApproval, listApprovals, transitionChange, transitionRequirement, updateRequirement } from "@/lib/domain/requirements";
import { createComment, deleteComment, editComment, listComments, setReaction } from "@/lib/domain/comments";
import { listDocuments, saveDocument } from "@/lib/domain/documents";
import { correctTime, listTime, logTime, setTimeStatus } from "@/lib/domain/time";
import { listPeople, updateEmployee, workload } from "@/lib/domain/people";
import { dashboard, exportRows, listAudit, listEmails, listLookups, listNotifications, markAllNotificationsRead, markNotificationRead, portalHome, searchAll, updateLookup, updatePreference } from "@/lib/domain/insights";
import { readCookie, SESSION_COOKIE } from "@/lib/cookies";
import { log } from "@/lib/log";

type Ctx = { req: Request; actor: NonNullable<Awaited<ReturnType<typeof actorFromToken>>> | null; parts: string[]; url: URL; requestId: string };


function assertOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("host");
  if (host && new URL(origin).host !== host) throw new AppError("FORBIDDEN", "Cross-origin request blocked.", 403);
}

async function body(req: Request) {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    throw validationError("Request body must be JSON.");
  }
}

function text(value: unknown, field: string, required = true) {
  if (typeof value !== "string" || !value.trim()) {
    if (!required) return undefined;
    throw validationError(`Check ${field}.`, { [field]: "This field is required." });
  }
  return value.trim();
}

function routeKey(method: string, parts: string[]) {
  return `${method} ${parts.join("/")}`;
}

export async function dispatch(req: Request, parts: string[]) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    if (req.method !== "GET" && req.method !== "HEAD") assertOrigin(req);
    const actor = await actorFromToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
    const ctx: Ctx = { req, actor, parts, url: new URL(req.url), requestId };
    const key = routeKey(req.method, parts);
    const data = await handle(key, ctx);
    return Response.json({ data }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    const appError = error instanceof AppError ? error : null;
    const status = appError?.status ?? 500;
    if (!appError) log("error", "api.unhandled", { requestId, reason: error instanceof Error ? error.message : "unknown" });
    return Response.json(
      { error: { code: appError?.code ?? "ERROR", message: appError?.message ?? "Something went wrong. Try again.", fields: appError?.fields, requestId } },
      { status, headers: { "x-request-id": requestId } },
    );
  }
}

async function handle(key: string, ctx: Ctx): Promise<unknown> {
  const { actor, parts, url } = ctx;
  const page = Number(url.searchParams.get("page") ?? 1);
  const q = url.searchParams.get("q") ?? undefined;
  const idempotencyKey = ctx.req.headers.get("idempotency-key");

  if (key === "POST auth/login") {
    const input = await body(ctx.req);
    const result = await loginWithPassword({ email: text(input.email, "email")!, password: text(input.password, "password")!, ip: ctx.req.headers.get("x-forwarded-for") ?? undefined, userAgent: ctx.req.headers.get("user-agent") ?? undefined });
    return { token: result.token, user: { id: result.actor.userId, name: result.actor.name, kind: result.actor.kind } };
  }
  if (key === "POST auth/forgot-password") {
    const input = await body(ctx.req);
    await requestPasswordReset(text(input.email, "email")!);
    return { ok: true };
  }
  if (key === "POST auth/reset-password") {
    const input = await body(ctx.req);
    await resetPassword(text(input.token, "token")!, text(input.password, "password")!);
    return { ok: true };
  }
  if (key === "POST auth/verify-email") {
    const input = await body(ctx.req);
    await verifyEmail(text(input.token, "token")!);
    return { ok: true };
  }
  if (key === "POST auth/accept-invite") {
    const input = await body(ctx.req);
    const id = await acceptInvitation(text(input.token, "token")!, text(input.password, "password")!);
    return { id };
  }
  if (!actor) throw new AppError("UNAUTHORIZED", "Sign in to continue.", 401);
  if (key === "POST auth/logout") {
    await logout(actor.sessionId);
    return { ok: true };
  }
  if (key === "POST auth/confirm-password") {
    const input = await body(ctx.req);
    await confirmPassword(actor, text(input.password, "password")!);
    return { ok: true };
  }
  if (key === "GET auth/session") return { id: actor.userId, name: actor.name, kind: actor.kind, permissions: actor.permissions };
  if (key === "GET customers") return listCustomers(actor, { page, q, status: url.searchParams.get("status") ?? undefined, tag: url.searchParams.get("tag") ?? undefined });
  if (key === "POST customers") {
    const input = await body(ctx.req);
    return createCustomer(actor, { name: text(input.name, "name")!, kind: input.kind === "individual" ? "individual" : "company", status: text(input.status, "status", false), industry: text(input.industry, "industry", false), source: text(input.source, "source", false), notes: text(input.notes, "notes", false), idempotencyKey });
  }
  if (parts[0] === "customers" && parts[1] && parts.length === 2 && ctx.req.method === "GET") return getCustomer(actor, parts[1]);
  if (parts[0] === "customers" && parts[1] && parts[2] === "archive") return archiveCustomer(actor, parts[1], false);
  if (parts[0] === "customers" && parts[1] && parts[2] === "restore") return archiveCustomer(actor, parts[1], true);
  if (parts[0] === "customers" && parts[1] && parts[2] === "contacts" && ctx.req.method === "POST") {
    const input = await body(ctx.req);
    return addContact(actor, parts[1], { name: text(input.name, "name")!, email: text(input.email, "email", false), phone: text(input.phone, "phone", false), title: text(input.title, "title", false), isPrimary: input.isPrimary === true, idempotencyKey });
  }
  if (key === "POST customers/merge") {
    const input = await body(ctx.req);
    await mergeCustomers(actor, text(input.sourceId, "sourceId")!, text(input.targetId, "targetId")!);
    return { ok: true };
  }
  if (key === "POST customers/duplicates") return findDuplicates(actor, await body(ctx.req) as { name?: string; email?: string; phone?: string });
  if (key === "GET leads") return listLeads(actor, { page, q, status: url.searchParams.get("status") ?? undefined });
  if (key === "POST leads") {
    const input = await body(ctx.req);
    return createLead(actor, { name: text(input.name, "name")!, company: text(input.company, "company", false), email: text(input.email, "email", false), phone: text(input.phone, "phone", false), source: text(input.source, "source", false), notes: text(input.notes, "notes", false), idempotencyKey });
  }
  if (parts[0] === "leads" && parts[2] === "transition") {
    const input = await body(ctx.req);
    await transitionLead(actor, parts[1]!, text(input.status, "status")!);
    return { ok: true };
  }
  if (parts[0] === "leads" && parts[2] === "convert") {
    const raw = await ctx.req.text();
    let input: Record<string, unknown> = {};
    if (raw.trim()) {
      try {
        input = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw validationError("Request body must be JSON.");
      }
    }
    return convertLead(actor, parts[1]!, idempotencyKey, text(input.existingCustomerId, "existingCustomerId", false));
  }
  if (parts[0] === "leads" && parts[2] === "assign") {
    const input = await body(ctx.req);
    const leadIds = Array.isArray(input.leadIds) ? input.leadIds.filter((value): value is string => typeof value === "string" && value.length > 0) : [];
    const role = input.role === "marketing" || input.role === "account" ? input.role : "sales";
    return assignLeads(actor, { leadIds, userId: text(input.userId, "userId", false) ?? null, teamId: text(input.teamId, "teamId", false) ?? null, role, reason: text(input.reason, "reason", false) ?? "", transferFollowUps: input.transferFollowUps === true, unassign: input.unassign === true, idempotencyKey });
  }
  if (key === "POST leads/merge") {
    const input = await body(ctx.req);
    await mergeLeads(actor, text(input.sourceId, "sourceId")!, text(input.targetId, "targetId")!);
    return { ok: true };
  }
  if (key === "GET opportunities") return listOpportunities(actor, { page, q, stage: url.searchParams.get("stage") ?? undefined });
  if (parts[0] === "opportunities" && parts.length === 2 && ctx.req.method === "GET") return getOpportunity(actor, parts[1]!);
  if (parts[0] === "opportunities" && parts[2] === "transition") {
    const input = await body(ctx.req);
    const result = await transitionOpportunity(actor, parts[1]!, text(input.stage, "stage")!, text(input.reason, "reason", false) ?? "", input.override === true);
    return { ok: true, ...result };
  }
  if (key === "POST reminders") {
    const input = await body(ctx.req);
    return addReminder(actor, { note: text(input.note, "note")!, dueAt: text(input.dueAt, "dueAt")!, leadId: text(input.leadId, "leadId", false), customerId: text(input.customerId, "customerId", false), projectId: text(input.projectId, "projectId", false) });
  }
  if (key === "GET projects") return listProjects(actor, { page, q, status: url.searchParams.get("status") ?? undefined, customerId: url.searchParams.get("customerId") ?? undefined, health: url.searchParams.get("health") ?? undefined });
  if (key === "POST projects") {
    const input = await body(ctx.req);
    return createProject(actor, { customerId: text(input.customerId, "customerId")!, name: text(input.name, "name")!, summary: text(input.summary, "summary", false), objectives: text(input.objectives, "objectives", false), scope: text(input.scope, "scope", false), priority: text(input.priority, "priority", false), projectType: text(input.projectType, "projectType", false), dueOn: text(input.dueOn, "dueOn", false), idempotencyKey });
  }
  if (parts[0] === "projects" && parts.length === 2 && ctx.req.method === "GET") return getProject(actor, parts[1]!);
  if (parts[0] === "projects" && parts[2] === "transition") {
    const input = await body(ctx.req);
    return transitionProject(actor, parts[1]!, text(input.status, "status")!, Number(input.version), text(input.overrideReason, "overrideReason", false));
  }
  if (parts[0] === "projects" && parts[2] === "members") {
    const input = await body(ctx.req);
    await addProjectMember(actor, parts[1]!, text(input.userId, "userId")!, text(input.role, "role")!);
    return { ok: true };
  }
  if (parts[0] === "projects" && parts[2] === "milestones" && ctx.req.method === "POST") {
    const input = await body(ctx.req);
    return createMilestone(actor, parts[1]!, { name: text(input.name, "name")!, dueOn: text(input.dueOn, "dueOn", false), description: text(input.description, "description", false) });
  }
  if (parts[0] === "milestones" && parts[2] === "transition") {
    const input = await body(ctx.req);
    await transitionMilestone(actor, parts[1]!, text(input.status, "status")!, Number(input.version), text(input.overrideReason, "overrideReason", false));
    return { ok: true };
  }
  if (parts[0] === "projects" && parts[2] === "onboarding") {
    const input = await body(ctx.req);
    await completeOnboarding(actor, parts[1]!, text(input.templateKey, "templateKey")!, text(input.note, "note", false) ?? "");
    return { ok: true };
  }
  if (parts[0] === "projects" && parts[2] === "issues") {
    const input = await body(ctx.req);
    return createIssue(actor, parts[1]!, { type: text(input.type, "type") as "risk" | "issue" | "blocker", title: text(input.title, "title")!, detail: text(input.detail, "detail", false) });
  }
  if (parts[0] === "projects" && parts[2] === "decisions") {
    const input = await body(ctx.req);
    return recordDecision(actor, parts[1]!, { title: text(input.title, "title")!, detail: text(input.detail, "detail")!, decidedOn: text(input.decidedOn, "decidedOn")!, visibility: input.visibility === "customer" ? "customer" : "internal" });
  }
  if (parts[0] === "projects" && parts[2] === "baseline") {
    await baselineScope(actor, parts[1]!);
    return { ok: true };
  }
  if (key === "GET tasks") return listTasks(actor, { page, q, status: url.searchParams.get("status") ?? undefined, assigneeId: url.searchParams.get("assigneeId") ?? undefined, projectId: url.searchParams.get("projectId") ?? undefined, overdue: url.searchParams.get("overdue") === "1" });
  if (key === "POST tasks") {
    const input = await body(ctx.req);
    return createTask(actor, { projectId: text(input.projectId, "projectId")!, title: text(input.title, "title")!, description: text(input.description, "description", false), priority: text(input.priority, "priority", false), assigneeId: text(input.assigneeId, "assigneeId", false), dueOn: text(input.dueOn, "dueOn", false), estimatedMinutes: Number(input.estimatedMinutes ?? 0), customerVisible: input.customerVisible === true, idempotencyKey });
  }
  if (parts[0] === "tasks" && parts[2] === "transition") {
    const input = await body(ctx.req);
    await transitionTask(actor, parts[1]!, text(input.status, "status")!, Number(input.version), text(input.overrideReason, "overrideReason", false));
    return { ok: true };
  }
  if (parts[0] === "tasks" && parts[2] === "assign") {
    const input = await body(ctx.req);
    await assignTask(actor, parts[1]!, text(input.assigneeId, "assigneeId", false) ?? null, Number(input.version));
    return { ok: true };
  }
  if (parts[0] === "tasks" && parts[2] === "dependencies") {
    const input = await body(ctx.req);
    await addTaskDependency(actor, parts[1]!, text(input.predecessorId, "predecessorId")!);
    return { ok: true };
  }
  if (key === "POST requirements") {
    const input = await body(ctx.req);
    return createRequirement(actor, { projectId: text(input.projectId, "projectId")!, title: text(input.title, "title")!, description: text(input.description, "description", false), acceptance: text(input.acceptance, "acceptance", false), priority: text(input.priority, "priority", false), idempotencyKey });
  }
  if (parts[0] === "requirements" && parts[2] === "transition") {
    const input = await body(ctx.req);
    await transitionRequirement(actor, parts[1]!, text(input.status, "status")!, Number(input.version));
    return { ok: true };
  }
  if (parts[0] === "requirements" && ctx.req.method === "PATCH") {
    const input = await body(ctx.req);
    await updateRequirement(actor, parts[1]!, Number(input.version), { title: text(input.title, "title", false), description: text(input.description, "description", false), acceptance: text(input.acceptance, "acceptance", false) });
    return { ok: true };
  }
  if (parts[0] === "changes" && parts[2] === "transition") {
    const input = await body(ctx.req);
    await transitionChange(actor, parts[1]!, text(input.status, "status")!, Number(input.version), text(input.decisionNote, "decisionNote", false));
    return { ok: true };
  }
  if (key === "GET approvals") return listApprovals(actor, url.searchParams.get("status") ?? "pending");
  if (parts[0] === "approvals" && parts[2] === "decide") {
    const input = await body(ctx.req);
    const decision = text(input.decision, "decision");
    if (decision !== "approved" && decision !== "rejected") throw validationError("Choose approve or reject.");
    await decideApproval(actor, parts[1]!, decision, text(input.comment, "comment", false) ?? "");
    return { ok: true };
  }
  if (key === "GET comments") return listComments(actor, url.searchParams.get("entityType") ?? "", url.searchParams.get("entityId") ?? "");
  if (key === "POST comments") {
    const input = await body(ctx.req);
    return createComment(actor, { entityType: text(input.entityType, "entityType")!, entityId: text(input.entityId, "entityId")!, body: text(input.body, "body")!, visibility: input.visibility === "customer" ? "customer" : "internal", parentId: text(input.parentId, "parentId", false), mentionIds: Array.isArray(input.mentionIds) ? input.mentionIds.filter((id): id is string => typeof id === "string") : [], idempotencyKey });
  }
  if (parts[0] === "comments" && parts[2] === "edit") {
    const input = await body(ctx.req);
    await editComment(actor, parts[1]!, text(input.body, "body")!);
    return { ok: true };
  }
  if (parts[0] === "comments" && parts[2] === "delete") {
    await deleteComment(actor, parts[1]!);
    return { ok: true };
  }
  if (parts[0] === "comments" && parts[2] === "react") {
    const input = await body(ctx.req);
    await setReaction(actor, parts[1]!, text(input.emoji, "emoji")!);
    return { ok: true };
  }
  if (key === "GET documents") return listDocuments(actor, { projectId: url.searchParams.get("projectId") ?? undefined, customerId: url.searchParams.get("customerId") ?? undefined });
  if (key === "POST documents") {
    const form = await ctx.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw validationError("Choose a file.", { file: "Choose a file." });
    return saveDocument(actor, { projectId: String(form.get("projectId") ?? "") || undefined, customerId: String(form.get("customerId") ?? "") || undefined, category: String(form.get("category") ?? "") || undefined, visibility: form.get("visibility") === "customer" ? "customer" : "internal", fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  if (key === "GET notifications") return listNotifications(actor);
  if (parts[0] === "notifications" && parts[1] && parts[2] === "read") {
    await markNotificationRead(actor, parts[1]);
    return { ok: true };
  }
  if (key === "POST notifications/read-all") {
    await markAllNotificationsRead(actor);
    return { ok: true };
  }
  if (key === "POST preferences") {
    const input = await body(ctx.req);
    await updatePreference(actor, text(input.eventType, "eventType")!, input.inApp !== false, input.email !== false);
    return { ok: true };
  }
  if (key === "GET search") return searchAll(actor, q ?? "");
  if (key === "GET dashboard") return dashboard(actor);
  if (key === "GET portal") return portalHome(actor);
  if (parts[0] === "exports" && parts[1] && ctx.req.method === "GET") {
    const type = parts[1];
    if (type !== "customers" && type !== "projects" && type !== "tasks" && type !== "time") throw validationError("Unknown export.");
    const csv = await exportRows(actor, type);
    return { csv };
  }
  if (key === "GET settings/lookups") return listLookups(actor, url.searchParams.get("kind") ?? undefined);
  if (parts[0] === "settings" && parts[1] === "lookups" && parts[2]) {
    const input = await body(ctx.req);
    await updateLookup(actor, parts[2], { label: text(input.label, "label", false), enabled: typeof input.enabled === "boolean" ? input.enabled : undefined });
    return { ok: true };
  }
  if (key === "GET settings/audit") return listAudit(actor, page);
  if (key === "GET settings/emails") return listEmails(actor);
  if (key === "GET people") return listPeople(actor, { q, status: url.searchParams.get("status") ?? undefined });
  if (key === "GET people/workload") return workload(actor);
  if (parts[0] === "people" && parts[1] && ctx.req.method === "PATCH") {
    const input = await body(ctx.req);
    await updateEmployee(actor, parts[1], { jobTitle: text(input.jobTitle, "jobTitle", false), status: input.status === "inactive" || input.status === "active" ? input.status : undefined, roleKeys: Array.isArray(input.roleKeys) ? input.roleKeys.filter((role): role is string => typeof role === "string") : undefined });
    return { ok: true };
  }
  if (key === "POST invitations") {
    const input = await body(ctx.req);
    const kind = input.kind === "customer" ? "customer" : "employee";
    return createInvitation(actor, { email: text(input.email, "email")!, name: text(input.name, "name")!, kind, roleKeys: Array.isArray(input.roleKeys) ? input.roleKeys.filter((role): role is string => typeof role === "string") : ["employee"], customerId: text(input.customerId, "customerId", false), contactId: text(input.contactId, "contactId", false) });
  }
  if (parts[0] === "invitations" && parts[2] === "revoke") {
    await revokeInvitation(actor, parts[1]!);
    return { ok: true };
  }
  if (key === "GET time") return listTime(actor, { userId: url.searchParams.get("userId") ?? undefined, projectId: url.searchParams.get("projectId") ?? undefined });
  if (key === "POST time") {
    const input = await body(ctx.req);
    return logTime(actor, { projectId: text(input.projectId, "projectId")!, taskId: text(input.taskId, "taskId", false), workOn: text(input.workOn, "workOn")!, minutes: Number(input.minutes), note: text(input.note, "note", false) });
  }
  if (parts[0] === "time" && parts[2] === "correct") {
    const input = await body(ctx.req);
    await correctTime(actor, parts[1]!, Number(input.minutes), text(input.reason, "reason")!);
    return { ok: true };
  }
  if (parts[0] === "time" && parts[2] === "status") {
    const input = await body(ctx.req);
    const status = text(input.status, "status");
    if (status !== "approved" && status !== "locked") throw validationError("Choose a valid time status.");
    await setTimeStatus(actor, parts[1]!, status);
    return { ok: true };
  }
  throw new AppError("NOT_FOUND", "That API route does not exist.", 404);
}

