"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { parseMoneyToCents } from "@/lib/money";
import { sessionCookie } from "@/lib/session";
import { requireCustomer, requireEmployee, requireUser } from "@/lib/session";
import { loginWithPassword, logout, requestPasswordReset, resetPassword, acceptInvitation } from "@/lib/domain/auth";
import { addContact, archiveCustomer, createCustomer } from "@/lib/domain/customers";
import { archiveOpportunity, assignLeads, commitLeadImport, completeCrmActivity, convertLead, createCampaign, createCrmActivity, createLead, mergeLeads, qualifyLead, saveRoutingRule, transitionLead, transitionOpportunity } from "@/lib/domain/leads";
import { completeOnboarding, createMilestone, createProject, transitionProject } from "@/lib/domain/projects";
import { createTask, transitionTask } from "@/lib/domain/tasks";
import { baselineScope, createRequirement, decideApproval, transitionChange } from "@/lib/domain/requirements";
import { createComment } from "@/lib/domain/comments";
import { logTime } from "@/lib/domain/time";
import { markAllNotificationsRead, markNotificationRead, nextDashboardOrder, saveDashboardLayout } from "@/lib/domain/insights";

export type ActionState = { error?: string; fields?: Record<string, string>; ok?: string } | null;

function failure(error: unknown): ActionState {
  if (typeof error === "object" && error && "digest" in error && String((error as { digest?: string }).digest).includes("NEXT_REDIRECT")) throw error;
  if (error instanceof AppError) return { error: error.message, fields: error.fields };
  return { error: "Something went wrong. Nothing was saved." };
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const result = await loginWithPassword({ email: String(formData.get("email") ?? ""), password: String(formData.get("password") ?? "") });
    const cookie = sessionCookie(result.token);
    const jar = await cookies();
    jar.set(cookie.name, cookie.value, cookie.options);
    redirect(result.actor.kind === "customer" ? "/portal" : "/dashboard");
  } catch (error) {
    return failure(error);
  }
}

export async function logoutAction() {
  const actor = await requireUser();
  await logout(actor.sessionId);
  const jar = await cookies();
  jar.delete(sessionCookie("").name);
  redirect("/login");
}

export async function forgotAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requestPasswordReset(String(formData.get("email") ?? ""));
    return { ok: "If an account exists for that email, a reset link is on its way." };
  } catch (error) {
    return failure(error);
  }
}

export async function resetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await resetPassword(String(formData.get("token") ?? ""), String(formData.get("password") ?? ""));
    redirect("/login");
  } catch (error) {
    return failure(error);
  }
}

export async function inviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await acceptInvitation(String(formData.get("token") ?? ""), String(formData.get("password") ?? ""));
    redirect("/login");
  } catch (error) {
    return failure(error);
  }
}

export async function customerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireEmployee();
  try {
    const created = await createCustomer(actor, {
      name: String(formData.get("name") ?? ""),
      kind: formData.get("kind") === "individual" ? "individual" : "company",
      status: String(formData.get("status") ?? "active"),
      industry: String(formData.get("industry") ?? "") || null,
      source: String(formData.get("source") ?? "") || null,
      notes: String(formData.get("notes") ?? ""),
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    });
    revalidatePath("/customers");
    redirect(`/customers/${created.id}`);
  } catch (error) {
    return failure(error);
  }
}

export async function contactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireEmployee();
  try {
    await addContact(actor, String(formData.get("customerId")), {
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      title: String(formData.get("title") ?? ""),
      isPrimary: formData.get("isPrimary") === "on",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    });
    revalidatePath(`/customers/${formData.get("customerId")}`);
    return { ok: "Contact saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function archiveCustomerAction(formData: FormData) {
  const actor = await requireEmployee();
  const id = String(formData.get("id"));
  await archiveCustomer(actor, id, formData.get("restore") === "1");
  revalidatePath(`/customers/${id}`);
  redirect(`/customers/${id}`);
}

export async function leadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireEmployee();
  try {
    const rawValue = String(formData.get("estimatedValue") ?? "").trim();
    const estimatedValueCents = rawValue ? parseMoneyToCents(rawValue) : null;
    if (rawValue && estimatedValueCents == null) return { error: "Enter the estimated value as a number, for example 12500.00.", fields: { estimatedValue: "Use a number with up to two decimals." } };
    const created = await createLead(actor, {
      name: String(formData.get("name") ?? ""),
      company: String(formData.get("company") ?? ""),
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? "") || undefined,
      industry: String(formData.get("industry") ?? "") || undefined,
      location: String(formData.get("location") ?? "") || undefined,
      priority: ["low", "medium", "high", "critical"].includes(String(formData.get("priority"))) ? String(formData.get("priority")) : "medium",
      estimatedValueCents: estimatedValueCents ?? undefined,
      campaignId: String(formData.get("campaignId") ?? "") || null,
      source: String(formData.get("source") ?? "") || undefined,
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    });
    revalidatePath("/leads");
    redirect(`/leads/${created.id}`);
  } catch (error) {
    return failure(error);
  }
}

export async function convertLeadAction(formData: FormData) {
  const actor = await requireEmployee();
  const existing = String(formData.get("existingCustomerId") ?? "");
  const result = await convertLead(actor, String(formData.get("id")), String(formData.get("idempotencyKey") ?? ""), existing || null);
  if (result.opportunityId) redirect(`/opportunities/${result.opportunityId}`);
  redirect(`/customers/${result.id}`);
}

export async function leadStatusAction(formData: FormData) {
  const actor = await requireEmployee();
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  try {
    await transitionLead(actor, id, status, String(formData.get("reason") ?? ""));
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    redirect(`/leads/${id}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  redirect(`/leads/${id}?notice=${encodeURIComponent(`Lead moved to ${status}.`)}`);
}

export async function assignLeadAction(formData: FormData) {
  const actor = await requireEmployee();
  const ids = formData.getAll("ids").map((value) => String(value).trim()).filter(Boolean);
  const role = String(formData.get("role") ?? "sales");
  await assignLeads(actor, {
    leadIds: ids.length ? ids : [String(formData.get("id") ?? "")],
    userId: String(formData.get("userId") ?? "") || null,
    teamId: String(formData.get("teamId") ?? "") || null,
    role: role === "marketing" || role === "account" ? role : "sales",
    reason: String(formData.get("reason") ?? ""),
    transferFollowUps: formData.get("transferFollowUps") === "1",
    unassign: formData.get("unassign") === "1",
    idempotencyKey: String(formData.get("idempotencyKey") ?? "") || null,
  });
  revalidatePath("/leads");
  for (const id of ids) revalidatePath(`/leads/${id}`);
}

export async function mergeLeadAction(formData: FormData) {
  const actor = await requireEmployee();
  const targetId = String(formData.get("targetId"));
  await mergeLeads(actor, String(formData.get("sourceId")), targetId);
  revalidatePath("/leads");
  redirect(`/leads/${targetId}`);
}

export async function qualifyLeadAction(formData: FormData) {
  const actor = await requireEmployee();
  const id = String(formData.get("id"));
  await qualifyLead(actor, id, {
    budget: String(formData.get("budget") ?? ""),
    authority: String(formData.get("authority") ?? ""),
    need: String(formData.get("need") ?? ""),
    timeline: String(formData.get("timeline") ?? ""),
    use_case: String(formData.get("use_case") ?? ""),
    competitors: String(formData.get("competitors") ?? ""),
    objections: String(formData.get("objections") ?? ""),
  });
  revalidatePath(`/leads/${id}`);
}

export async function crmActivityAction(formData: FormData) {
  const actor = await requireEmployee();
  const leadId = String(formData.get("leadId") ?? "");
  await createCrmActivity(actor, { leadId, type: String(formData.get("type") ?? "follow_up"), subject: String(formData.get("subject") ?? ""), notes: String(formData.get("notes") ?? ""), dueAt: String(formData.get("dueAt") ?? "") || undefined, recurrence: String(formData.get("recurrence") ?? "none") });
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
}

export async function completeActivityAction(formData: FormData) {
  const actor = await requireEmployee();
  const leadId = String(formData.get("leadId") ?? "");
  await completeCrmActivity(actor, String(formData.get("id")));
  revalidatePath("/leads");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

export async function routingRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireEmployee();
  try {
    await saveRoutingRule(actor, {
      name: String(formData.get("name") ?? ""),
      strategy: String(formData.get("strategy") ?? "round_robin"),
      userIds: formData.getAll("userIds").map((value) => String(value)).filter(Boolean),
      source: String(formData.get("source") ?? "") || undefined,
      industry: String(formData.get("industry") ?? "") || undefined,
    });
    revalidatePath("/campaigns");
    return { ok: "Routing rule saved. New matches explain which rule chose the owner." };
  } catch (error) {
    return failure(error);
  }
}

export async function archiveOpportunityAction(formData: FormData) {
  const actor = await requireEmployee();
  const id = String(formData.get("id"));
  await archiveOpportunity(actor, id, formData.get("restore") === "1");
  revalidatePath(`/opportunities/${id}`);
  revalidatePath("/opportunities");
}

export async function importLeadsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireEmployee();
  try {
    const result = await commitLeadImport(actor, String(formData.get("csv") ?? ""));
    revalidatePath("/leads");
    return { ok: `Created ${result.created}, skipped ${result.skipped}, failed ${result.failed}.` };
  } catch (error) {
    return failure(error);
  }
}

export async function campaignAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireEmployee();
  try {
    const rawBudget = String(formData.get("budget") ?? "").trim();
    const budgetCents = rawBudget ? parseMoneyToCents(rawBudget) : null;
    if (rawBudget && budgetCents == null) return { error: "Enter the budget as a number, for example 5000.00." };
    await createCampaign(actor, {
      name: String(formData.get("name") ?? ""),
      channel: String(formData.get("channel") ?? "other"),
      source: String(formData.get("source") ?? "") || undefined,
      audience: String(formData.get("audience") ?? "") || undefined,
      startsOn: String(formData.get("startsOn") ?? "") || undefined,
      endsOn: String(formData.get("endsOn") ?? "") || undefined,
      budgetCents: budgetCents ?? undefined,
      goal: String(formData.get("goal") ?? ""),
    });
    revalidatePath("/campaigns");
    return { ok: "Campaign saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function opportunityStageAction(formData: FormData) {
  const actor = await requireEmployee();
  const id = String(formData.get("id"));
  const stage = String(formData.get("stage"));
  let notice = `Moved to ${stage}.`;
  try {
    const { project } = await transitionOpportunity(actor, id, stage, String(formData.get("reason") ?? ""), formData.get("override") === "1");
    if (project && "skipped" in project) notice = `Marked won. The project was not started: ${project.skipped}`;
    else if (project) {
      notice = project.created ? `Marked won. Project ${project.code} and its SRS draft were created.` : `Marked won. Project ${project.code} already exists for this deal.`;
      revalidatePath("/projects");
      revalidatePath(`/projects/${project.id}`);
    }
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    redirect(`/opportunities/${id}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/opportunities");
  revalidatePath(`/opportunities/${id}`);
  redirect(`/opportunities/${id}?notice=${encodeURIComponent(notice)}`);
}

export async function projectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireEmployee();
  try {
    const created = await createProject(actor, { customerId: String(formData.get("customerId")), name: String(formData.get("name") ?? ""), summary: String(formData.get("summary") ?? ""), objectives: String(formData.get("objectives") ?? ""), scope: String(formData.get("scope") ?? ""), priority: String(formData.get("priority") ?? "medium"), projectType: String(formData.get("projectType") ?? "custom"), dueOn: String(formData.get("dueOn") ?? "") || undefined, idempotencyKey: String(formData.get("idempotencyKey") ?? "") });
    revalidatePath("/projects");
    redirect(`/projects/${created.id}`);
  } catch (error) {
    return failure(error);
  }
}

async function projectFeedback(id: string, tab: string | null, work: () => Promise<string>) {
  const params = new URLSearchParams(tab ? { tab } : {});
  try {
    params.set("notice", await work());
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    params.set("error", error.message);
  }
  revalidatePath(`/projects/${id}`);
  redirect(`/projects/${id}?${params}`);
}

export async function projectStatusAction(formData: FormData) {
  const actor = await requireEmployee();
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  await projectFeedback(id, null, async () => {
    await transitionProject(actor, id, status, Number(formData.get("version")), String(formData.get("overrideReason") ?? "") || undefined);
    return `Project moved to ${status.replaceAll("_", " ")}.`;
  });
}

export async function onboardingAction(formData: FormData) {
  const actor = await requireEmployee();
  const id = String(formData.get("projectId"));
  await projectFeedback(id, null, async () => {
    await completeOnboarding(actor, id, String(formData.get("templateKey")), String(formData.get("note") ?? ""));
    return "Onboarding step completed.";
  });
}

export async function milestoneAction(formData: FormData) {
  const actor = await requireEmployee();
  const id = String(formData.get("projectId"));
  await projectFeedback(id, null, async () => {
    await createMilestone(actor, id, { name: String(formData.get("name") ?? ""), dueOn: String(formData.get("dueOn") ?? "") || undefined });
    return "Milestone added.";
  });
}

export async function taskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  try {
    await createTask(actor, { projectId: String(formData.get("projectId")), title: String(formData.get("title") ?? ""), priority: String(formData.get("priority") ?? "medium"), dueOn: String(formData.get("dueOn") ?? "") || undefined, estimatedMinutes: Number(formData.get("estimatedMinutes") ?? 0), customerVisible: formData.get("customerVisible") === "on", idempotencyKey: String(formData.get("idempotencyKey") ?? "") });
    revalidatePath(`/projects/${formData.get("projectId")}`);
    return { ok: "Task created." };
  } catch (error) {
    return failure(error);
  }
}

export async function taskStatusAction(formData: FormData) {
  const actor = await requireEmployee();
  await transitionTask(actor, String(formData.get("id")), String(formData.get("status")), Number(formData.get("version")), String(formData.get("overrideReason") ?? "") || undefined);
  revalidatePath("/work");
  revalidatePath(`/projects/${formData.get("projectId")}`);
}

export async function requirementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  try {
    const created = await createRequirement(actor, { projectId: String(formData.get("projectId")), title: String(formData.get("title") ?? ""), description: String(formData.get("description") ?? ""), acceptance: String(formData.get("acceptance") ?? ""), priority: String(formData.get("priority") ?? "medium"), idempotencyKey: String(formData.get("idempotencyKey") ?? "") });
    revalidatePath(`/projects/${formData.get("projectId")}`);
    return { ok: created.changeRequestId ? "Recorded as a change request so the approved scope stays intact." : "Requirement added." };
  } catch (error) {
    return failure(error);
  }
}

export async function baselineAction(formData: FormData) {
  const actor = await requireEmployee();
  const id = String(formData.get("projectId"));
  await projectFeedback(id, "requirements", async () => {
    await baselineScope(actor, id);
    return "Approved scope baselined.";
  });
}

export async function changeStatusAction(formData: FormData) {
  const actor = await requireUser();
  await transitionChange(actor, String(formData.get("id")), String(formData.get("status")), Number(formData.get("version")), String(formData.get("decisionNote") ?? ""));
  revalidatePath(`/projects/${formData.get("projectId")}`);
}

export async function approvalAction(formData: FormData) {
  const actor = await requireUser();
  const decision = formData.get("decision") === "rejected" ? "rejected" : "approved";
  await decideApproval(actor, String(formData.get("id")), decision, String(formData.get("comment") ?? ""));
  revalidatePath("/approvals");
  revalidatePath("/portal/approvals");
}

export async function commentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireUser();
  try {
    await createComment(actor, {
      entityType: String(formData.get("entityType")),
      entityId: String(formData.get("entityId")),
      body: String(formData.get("body") ?? ""),
      visibility: formData.get("visibility") === "customer" ? "customer" : "internal",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    });
    const entityType = String(formData.get("entityType"));
    const entityId = String(formData.get("entityId"));
    if (entityType === "lead") revalidatePath(`/leads/${entityId}`);
    else if (entityType === "opportunity") revalidatePath(`/opportunities/${entityId}`);
    else revalidatePath(`/projects/${formData.get("projectId")}`);
    return { ok: "Comment posted." };
  } catch (error) {
    return failure(error);
  }
}

export async function timeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireEmployee();
  try {
    await logTime(actor, { projectId: String(formData.get("projectId")), workOn: String(formData.get("workOn")), minutes: Number(formData.get("minutes")), note: String(formData.get("note") ?? "") });
    revalidatePath("/time");
    return { ok: "Time recorded." };
  } catch (error) {
    return failure(error);
  }
}

export async function readNotificationAction(formData: FormData) {
  const actor = await requireUser();
  await markNotificationRead(actor, String(formData.get("id")));
  revalidatePath("/notifications");
}

export async function readAllAction() {
  const actor = await requireUser();
  await markAllNotificationsRead(actor);
  revalidatePath("/notifications");
}

export async function dashboardLayoutAction(formData: FormData) {
  const actor = await requireEmployee();
  const direction = formData.get("direction") === "down" ? "down" : "up";
  const next = nextDashboardOrder(String(formData.get("order") ?? ""), String(formData.get("widget") ?? ""), direction);
  await saveDashboardLayout(actor, next);
  revalidatePath("/dashboard");
}

export async function requirePortalActor() {
  return requireCustomer();
}
