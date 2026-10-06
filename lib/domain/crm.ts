import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { can, requirePermission } from "@/lib/actor";
import { ensureRoleTemplates } from "@/lib/domain/bootstrap";
import { explainScore, type ScoreRule } from "@/lib/domain/crm-score";
import { addContact, createCustomer } from "@/lib/domain/customers";
import { startProjectFromOpportunity } from "@/lib/domain/projects";
import { appUrl, nextCode, notifyUser, rememberIdempotency, replayOrClaim, scheduleOutbox, writeActivity, writeAudit } from "@/lib/domain/support";
import { OPPORTUNITY_TRANSITIONS, STAGE_PROBABILITY, canTransition } from "@/lib/domain/workflow";
import { AppError, conflict, forbidden, notFound, validationError } from "@/lib/errors";
import { cleanText, searchBlob } from "@/lib/text";

const OPEN_LEAD = ["new", "contacted", "working", "qualified", "nurturing", "dormant"];
const CLOSED_LEAD = ["converted", "lost", "archived", "unqualified"];
const PAGE = 25;

const DEFAULT_RULES: ScoreRule[] = [
  { key: "has_email", label: "Email address is present", points: 10, enabled: true, kind: "attribute", match: "email" },
  { key: "has_phone", label: "Phone number is present", points: 10, enabled: true, kind: "attribute", match: "phone" },
  { key: "has_company", label: "Company is known", points: 10, enabled: true, kind: "attribute", match: "company" },
  { key: "source_referral", label: "Source is referral", points: 20, enabled: true, kind: "source", match: "referral" },
  { key: "source_partner", label: "Source is partner", points: 15, enabled: true, kind: "source", match: "partner" },
  { key: "value", label: "Estimated value is set", points: 15, enabled: true, kind: "attribute", match: "value" },
  { key: "priority_high", label: "Priority is high or critical", points: 15, enabled: true, kind: "priority", match: "high" },
  { key: "engaged", label: "At least one completed activity", points: 15, enabled: true, kind: "engagement", match: "1" },
];

export type LeadQuery = {
  page?: number;
  q?: string;
  status?: string;
  view?: string;
  ownerId?: string;
  source?: string;
  priority?: string;
  campaignId?: string;
};

export async function listLeads(actor: Actor, query: LeadQuery) {
  requirePermission(actor, "leads.view");
  await ensureRoleTemplates();
  await ensureCrmDefaults(actor.organizationId);
  const page = Math.max(1, query.page ?? 1);
  const q = query.q?.trim().toLowerCase();
  const where = {
    AND: [
      { organizationId: actor.organizationId, mergedIntoId: null },
      leadScope(actor),
      viewFilter(actor, query.view),
      query.status ? { status: query.status } : query.view ? {} : { status: { not: "archived" } },
      query.ownerId ? { ownerId: query.ownerId } : {},
      query.source ? { source: query.source } : {},
      query.priority ? { priority: query.priority } : {},
      query.campaignId ? { campaignId: query.campaignId } : {},
      q ? { searchText: { contains: q } } : {},
    ],
  };
  const [total, items, queues] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: [{ nextFollowUpAt: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        owner: { select: { id: true, name: true, status: true } },
        marketingOwner: { select: { id: true, name: true, status: true } },
        salesOwner: { select: { id: true, name: true, status: true } },
        team: { select: { id: true, name: true, archivedAt: true } },
        campaign: { select: { id: true, name: true } },
      },
    }),
    queueCounts(actor),
  ]);
  return { items: items.map(presentLead), page, pageSize: PAGE, total, queues };
}

export async function getLead(actor: Actor, id: string) {
  requirePermission(actor, "leads.view");
  const lead = await prisma.lead.findFirst({
    where: { id, organizationId: actor.organizationId, ...leadScope(actor) },
    include: {
      owner: { select: { id: true, name: true, status: true } },
      marketingOwner: { select: { id: true, name: true, status: true } },
      salesOwner: { select: { id: true, name: true, status: true } },
      accountManager: { select: { id: true, name: true, status: true } },
      assignedBy: { select: { name: true } },
      team: { select: { id: true, name: true, archivedAt: true } },
      campaign: { select: { id: true, name: true, channel: true } },
      assignments: { orderBy: { createdAt: "desc" }, take: 20 },
      activities: { orderBy: { dueAt: "asc" }, take: 30, include: { owner: { select: { name: true } } } },
      opportunities: { where: { archivedAt: null }, select: { id: true, code: true, name: true, stage: true, valueCents: true, currency: true } },
      scoreEvents: { orderBy: { createdAt: "desc" }, take: 8 },
    },
  });
  if (!lead) throw notFound("Lead not found.");
  const duplicates = await findLeadDuplicates(actor, { email: lead.email, phone: lead.phone, domain: lead.domain, excludeId: lead.id });
  const timeline = await prisma.activity.findMany({
    where: { organizationId: actor.organizationId, entityType: "lead", entityId: id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const userIds = [...new Set(lead.assignments.flatMap((entry) => [entry.fromUserId, entry.toUserId]).filter((value): value is string => Boolean(value)))];
  const names = new Map((userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds }, organizationId: actor.organizationId }, select: { id: true, name: true } }) : []).map((user) => [user.id, user.name]));
  const assignments = lead.assignments.map((entry) => ({ ...entry, fromName: entry.fromUserId ? names.get(entry.fromUserId) ?? "Former employee" : null, toName: entry.toUserId ? names.get(entry.toUserId) ?? "Former employee" : null }));
  return { ...presentLead(lead), assignments, activities: lead.activities, opportunities: lead.opportunities, scoreEvents: lead.scoreEvents, duplicates, timeline, qualification: parseJson(lead.qualification) };
}

export function leadScope(actor: Actor) {
  if (can(actor, "leads.assign") || can(actor, "reports.view") || can(actor, "crm.routing")) return {};
  return {
    OR: [
      { ownerId: actor.userId },
      { marketingOwnerId: actor.userId },
      { salesOwnerId: actor.userId },
      { accountManagerId: actor.userId },
      { team: { members: { some: { userId: actor.userId } } } },
    ],
  };
}

function viewFilter(actor: Actor, view?: string) {
  const now = new Date();
  if (view === "mine") return { status: { in: OPEN_LEAD }, OR: [{ ownerId: actor.userId }, { marketingOwnerId: actor.userId }, { salesOwnerId: actor.userId }] };
  if (view === "team") return { status: { in: OPEN_LEAD }, team: { members: { some: { userId: actor.userId } } } };
  if (view === "unassigned") return { status: { in: OPEN_LEAD }, ownershipStatus: "unassigned" };
  if (view === "recent") return { status: { not: "archived" }, assignedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } };
  if (view === "overdue") return { nextFollowUpAt: { lt: now }, status: { notIn: CLOSED_LEAD } };
  if (view === "hot") return { status: { in: OPEN_LEAD }, OR: [{ priority: { in: ["high", "critical"] } }, { score: { gte: 70 } }] };
  if (view === "new" || view === "nurturing" || view === "qualified" || view === "converted" || view === "lost") return { status: view };
  return {};
}

async function queueCounts(actor: Actor) {
  const now = new Date();
  const base = { AND: [{ organizationId: actor.organizationId, mergedIntoId: null }, leadScope(actor)] };
  const [mine, unassigned, overdue, hot, nurturing] = await Promise.all([
    prisma.lead.count({ where: { AND: [...base.AND, { OR: [{ ownerId: actor.userId }, { marketingOwnerId: actor.userId }, { salesOwnerId: actor.userId }], status: { in: OPEN_LEAD } }] } }),
    can(actor, "leads.assign") ? prisma.lead.count({ where: { AND: [...base.AND, { ownershipStatus: "unassigned", status: { in: OPEN_LEAD } }] } }) : Promise.resolve(0),
    prisma.lead.count({ where: { AND: [...base.AND, { nextFollowUpAt: { lt: now }, status: { notIn: CLOSED_LEAD } }] } }),
    prisma.lead.count({ where: { AND: [...base.AND, { status: { in: OPEN_LEAD }, OR: [{ priority: { in: ["high", "critical"] } }, { score: { gte: 70 } }] }] } }),
    prisma.lead.count({ where: { AND: [...base.AND, { status: "nurturing" }] } }),
  ]);
  return { mine, unassigned, overdue, hot, nurturing };
}

export async function scoreAndStore(organizationId: string, leadId: string) {
  const [lead, rules, activityCount] = await Promise.all([
    prisma.lead.findFirst({ where: { id: leadId, organizationId } }),
    loadRules(organizationId),
    prisma.crmActivity.count({ where: { leadId, status: "done" } }),
  ]);
  if (!lead) return null;
  const result = explainScore({
    source: lead.source,
    industry: lead.industry,
    email: lead.email,
    phone: lead.phone,
    company: lead.company,
    estimatedValueCents: lead.estimatedValueCents,
    priority: lead.priority,
    activityCount,
  }, rules);
  if (lead.score === result.score && lead.scoreExplanation === JSON.stringify(result.reasons)) return result;
  await prisma.$transaction([
    prisma.lead.update({ where: { id: leadId }, data: { score: result.score, scoreExplanation: JSON.stringify(result.reasons) } }),
    prisma.leadScoreEvent.create({ data: { leadId, score: result.score, reasons: JSON.stringify(result.reasons) } }),
  ]);
  return result;
}

async function loadRules(organizationId: string) {
  await ensureCrmDefaults(organizationId);
  return prisma.leadScoreRule.findMany({ where: { organizationId } });
}

export async function assignLeads(actor: Actor, input: { leadIds: string[]; userId?: string | null; teamId?: string | null; role?: "sales" | "marketing" | "account"; reason?: string; transferFollowUps?: boolean; unassign?: boolean; idempotencyKey?: string | null }) {
  requirePermission(actor, "leads.assign");
  const ids = [...new Set(input.leadIds.map((id) => id.trim()).filter(Boolean))].slice(0, 100);
  if (!ids.length) throw validationError("Select at least one lead.");
  const replay = await replayOrClaim(prisma, actor, input.idempotencyKey, "lead-assign");
  if (replay) return { assigned: [], skipped: [], replayed: true };
  const target = input.unassign ? null : await resolveAssignee(actor, input);
  const assigned: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const id of ids) {
    const outcome = await assignOne(actor, id, target, input);
    if (outcome.ok) assigned.push(id);
    else skipped.push({ id, reason: outcome.reason });
  }
  if (!assigned.length) throw validationError(skipped[0]?.reason ?? "No leads were assigned.");
  await rememberIdempotency(prisma, actor, input.idempotencyKey, "lead-assign", assigned[0] ?? "batch");
  scheduleOutbox();
  return { assigned, skipped, replayed: false };
}

async function assignOne(actor: Actor, id: string, target: { userId: string | null; teamId: string | null; role: "sales" | "marketing" | "account" } | null, input: { reason?: string; transferFollowUps?: boolean; unassign?: boolean }) {
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id, organizationId: actor.organizationId, mergedIntoId: null } });
    if (!lead) return { ok: false as const, reason: "Lead not found." };
    if (lead.archivedAt) return { ok: false as const, reason: `${lead.code} is archived.` };
    const reason = cleanText(input.reason ?? "", 500);
    if (target?.userId && lead.teamId && target.teamId == null) {
      const member = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId: lead.teamId, userId: target.userId } } });
      if (!member && reason.length < 3) return { ok: false as const, reason: `${lead.code} belongs to a team. Add a reason to assign someone outside that team.` };
    }
    const nextUser = input.unassign ? null : target?.userId ?? lead.ownerId;
    const nextTeam = input.unassign ? null : target?.teamId ?? lead.teamId;
    if (!input.unassign && nextUser === lead.ownerId && nextTeam === lead.teamId && (!target?.role || sameRoleOwner(lead, target.role, nextUser))) {
      return { ok: false as const, reason: `${lead.code} is already owned that way.` };
    }
    const role = target?.role ?? "sales";
    const data = {
      ownerId: nextUser,
      teamId: nextTeam,
      marketingOwnerId: input.unassign ? null : role === "marketing" ? nextUser : lead.marketingOwnerId,
      salesOwnerId: input.unassign ? null : role === "sales" ? nextUser : lead.salesOwnerId,
      accountManagerId: input.unassign ? null : role === "account" ? nextUser : lead.accountManagerId,
      assignedAt: input.unassign ? null : new Date(),
      assignedById: actor.userId,
      assignmentReason: reason,
      ownershipStatus: input.unassign ? "unassigned" : nextUser ? "assigned" : "team",
      version: { increment: 1 },
    };
    const updated = await tx.lead.updateMany({ where: { id, version: lead.version }, data });
    if (updated.count !== 1) return { ok: false as const, reason: `${lead.code} was updated by someone else. Refresh and try again.` };
    await tx.leadAssignment.create({
      data: {
        organizationId: actor.organizationId,
        leadId: id,
        fromUserId: lead.ownerId,
        toUserId: nextUser,
        fromTeamId: lead.teamId,
        toTeamId: nextTeam,
        assignmentType: input.unassign ? "unassign" : lead.ownerId && lead.ownerId !== nextUser ? "transfer" : "assign",
        reason,
        actorId: actor.userId,
        actorName: actor.name,
      },
    });
    if (input.transferFollowUps && nextUser) {
      await tx.crmActivity.updateMany({ where: { leadId: id, status: "open" }, data: { ownerId: nextUser } });
      await tx.reminder.updateMany({ where: { leadId: id, status: "open" }, data: { assigneeId: nextUser } });
    }
    await writeAudit(tx, actor, { action: input.unassign ? "lead.unassign" : "lead.assign", entityType: "lead", entityId: id, before: { ownerId: lead.ownerId, teamId: lead.teamId }, after: { ownerId: nextUser, teamId: nextTeam, reason } });
    await writeActivity(tx, actor, { type: "lead.assignment", summary: input.unassign ? `${lead.name} is unassigned` : `${lead.name} was assigned`, entityType: "lead", entityId: id });
    if (nextUser && nextUser !== actor.userId) {
      const person = await tx.user.findFirst({ where: { id: nextUser, organizationId: actor.organizationId } });
      if (person) {
        await notifyUser(tx, {
          organizationId: actor.organizationId,
          userId: person.id,
          type: "lead.assigned",
          title: `Lead assigned: ${lead.name}`,
          body: reason || `${actor.name} assigned ${lead.code} to you.`,
          href: `/leads/${lead.id}`,
          dedupeKey: `lead.assign:${lead.id}:${person.id}:${lead.version + 1}`,
          email: { to: person.email, template: "lead_assigned", mandatory: true, payload: { lead: lead.name, code: lead.code, actor: actor.name, reason: reason || "No reason recorded.", url: appUrl(`/leads/${lead.id}`) } },
        });
      }
    }
    return { ok: true as const };
  });
}

function sameRoleOwner(lead: { marketingOwnerId: string | null; salesOwnerId: string | null; accountManagerId: string | null }, role: "sales" | "marketing" | "account", userId: string | null) {
  if (role === "marketing") return lead.marketingOwnerId === userId;
  if (role === "account") return lead.accountManagerId === userId;
  return lead.salesOwnerId === userId;
}

async function resolveAssignee(actor: Actor, input: { userId?: string | null; teamId?: string | null; role?: "sales" | "marketing" | "account" }) {
  let userId = input.userId || null;
  let teamId = input.teamId || null;
  if (!userId && !teamId) throw validationError("Choose an employee or a team.");
  if (userId) {
    const person = await prisma.user.findFirst({
      where: { id: userId, organizationId: actor.organizationId, kind: "employee" },
      include: { roles: { include: { role: { include: { permissions: true } } } } },
    });
    if (!person || person.status !== "active" || person.deactivatedAt) throw validationError("That employee is inactive and cannot own leads.");
    const permissions = person.roles.flatMap((entry) => entry.role.permissions.map((item) => item.permission));
    if (!permissions.includes("leads.view") && !permissions.includes("leads.edit")) throw validationError("That employee is not allowed to work leads.");
    userId = person.id;
  }
  if (teamId) {
    const team = await prisma.team.findFirst({ where: { id: teamId, organizationId: actor.organizationId } });
    if (!team || team.archivedAt) throw validationError("That team is archived.");
    if (userId) {
      const member = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
      if (!member) throw validationError("That employee is not on the selected team.");
    }
    teamId = team.id;
  }
  return { userId, teamId, role: input.role ?? "sales" };
}

export async function routeLead(actor: Actor, leadId: string) {
  requirePermission(actor, "crm.routing");
  const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: actor.organizationId } });
  if (!lead) throw notFound("Lead not found.");
  const rules = await prisma.routingRule.findMany({ where: { organizationId: actor.organizationId, enabled: true }, orderBy: { sort: "asc" } });
  for (const rule of rules) {
    const criteria = parseJson(rule.criteria) as { source?: string; industry?: string; minScore?: number };
    if (criteria.source && criteria.source !== lead.source) continue;
    if (criteria.industry && criteria.industry !== lead.industry) continue;
    if (typeof criteria.minScore === "number" && lead.score < criteria.minScore) continue;
    const chosen = await nextRoutedUser(rule);
    if (!chosen) continue;
    const result = await assignLeads(actor, { leadIds: [leadId], userId: chosen.id, teamId: rule.teamId, reason: `Routing rule “${rule.name}” matched ${routeWhy(criteria, lead)}.` });
    return { ...result, explanation: `Assigned by ${rule.name} because ${routeWhy(criteria, lead)}. ${chosen.name} was next among available employees.` };
  }
  return { assigned: [], skipped: [{ id: leadId, reason: "No routing rule matched an available employee. The lead stays in the unassigned queue." }], explanation: "No routing rule matched an available employee.", replayed: false };
}

function routeWhy(criteria: { source?: string; industry?: string; minScore?: number }, lead: { source: string | null; industry: string | null; score: number }) {
  const parts = [];
  if (criteria.source) parts.push(`source is ${lead.source ?? "empty"}`);
  if (criteria.industry) parts.push(`industry is ${lead.industry ?? "empty"}`);
  if (typeof criteria.minScore === "number") parts.push(`score ${lead.score} meets ${criteria.minScore}`);
  return parts.join(", ") || "the rule has no extra criteria";
}

async function nextRoutedUser(rule: { id: string; strategy: string; userIds: string; cursor: number; organizationId: string }) {
  const ids = parseStringArray(rule.userIds);
  if (!ids.length) return null;
  if (rule.strategy === "round_robin") {
    for (let offset = 0; offset < ids.length; offset += 1) {
      const index = (rule.cursor + offset) % ids.length;
      const person = await prisma.user.findFirst({ where: { id: ids[index], organizationId: rule.organizationId, kind: "employee", status: "active", deactivatedAt: null } });
      if (!person) continue;
      await prisma.routingRule.update({ where: { id: rule.id }, data: { cursor: (index + 1) % ids.length } });
      return person;
    }
    return null;
  }
  return prisma.user.findFirst({ where: { id: ids[0], organizationId: rule.organizationId, kind: "employee", status: "active", deactivatedAt: null } });
}

export async function saveRoutingRule(actor: Actor, input: { name: string; strategy: string; userIds: string[]; teamId?: string; source?: string; industry?: string; minScore?: number }) {
  requirePermission(actor, "crm.routing");
  const name = cleanText(input.name, 80);
  if (name.length < 2) throw validationError("Name the routing rule.");
  if (!["round_robin", "first_available"].includes(input.strategy)) throw validationError("Choose a routing strategy.");
  if (input.userIds.length === 0) throw validationError("Choose at least one employee.");
  return prisma.routingRule.create({
    data: {
      organizationId: actor.organizationId,
      name,
      strategy: input.strategy,
      teamId: input.teamId || null,
      userIds: JSON.stringify(input.userIds),
      criteria: JSON.stringify({ source: input.source || undefined, industry: input.industry || undefined, minScore: input.minScore }),
    },
  });
}

export async function listAssignableEmployees(actor: Actor) {
  requirePermission(actor, "leads.assign");
  return prisma.user.findMany({
    where: { organizationId: actor.organizationId, kind: "employee", status: "active", deactivatedAt: null, roles: { some: { role: { permissions: { some: { permission: "leads.view" } } } } } },
    select: { id: true, name: true, jobTitle: true },
    orderBy: { name: "asc" },
  });
}

export async function leadWorkload(actor: Actor) {
  requirePermission(actor, "leads.assign");
  const now = new Date();
  const [open, overdue] = await Promise.all([
    prisma.lead.groupBy({ by: ["ownerId"], where: { organizationId: actor.organizationId, mergedIntoId: null, archivedAt: null, status: { in: OPEN_LEAD }, ownerId: { not: null } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["ownerId"], where: { organizationId: actor.organizationId, mergedIntoId: null, archivedAt: null, status: { in: OPEN_LEAD }, ownerId: { not: null }, nextFollowUpAt: { lt: now } }, _count: { _all: true } }),
  ]);
  const result = new Map<string, { open: number; overdue: number }>();
  for (const row of open) if (row.ownerId) result.set(row.ownerId, { open: row._count._all, overdue: 0 });
  for (const row of overdue) if (row.ownerId) result.set(row.ownerId, { open: result.get(row.ownerId)?.open ?? 0, overdue: row._count._all });
  return result;
}

export async function listCampaignOptions(actor: Actor) {
  if (!can(actor, "leads.create") && !can(actor, "leads.view")) return [];
  return prisma.campaign.findMany({ where: { organizationId: actor.organizationId, archivedAt: null, status: "active" }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 100 });
}

export async function listCrmTeams(actor: Actor) {
  requirePermission(actor, "leads.assign");
  return prisma.team.findMany({ where: { organizationId: actor.organizationId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export async function listRoutingRules(actor: Actor) {
  requirePermission(actor, "crm.routing");
  return prisma.routingRule.findMany({ where: { organizationId: actor.organizationId }, orderBy: { sort: "asc" } });
}

export async function createOpportunity(actor: Actor, input: { customerId: string; name: string; leadId?: string | null; contactId?: string | null; valueCents?: number; expectedCloseOn?: string; source?: string; campaignId?: string | null }) {
  requirePermission(actor, "opportunities.edit");
  const name = cleanText(input.name, 160);
  if (name.length < 2) throw validationError("Name the opportunity.");
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, organizationId: actor.organizationId } });
  if (!customer) throw notFound("Customer not found.");
  return prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, actor.organizationId, "opportunity", "OPP");
    const opportunity = await tx.opportunity.create({
      data: {
        organizationId: actor.organizationId,
        code,
        name,
        customerId: customer.id,
        leadId: input.leadId || null,
        contactId: input.contactId || null,
        ownerId: actor.userId,
        source: input.source,
        campaignId: input.campaignId || null,
        valueCents: Math.max(0, input.valueCents ?? 0),
        currency: actor.currency,
        expectedCloseOn: input.expectedCloseOn || null,
        probability: STAGE_PROBABILITY.qualification ?? 10,
        searchText: searchBlob([name, code, customer.name]),
      },
    });
    await tx.opportunityEvent.create({ data: { opportunityId: opportunity.id, fromStage: "", toStage: "qualification", actorId: actor.userId, actorName: actor.name, reason: "Opened" } });
    await writeAudit(tx, actor, { action: "opportunity.create", entityType: "opportunity", entityId: opportunity.id, after: { name, customerId: customer.id } });
    return opportunity;
  });
}

export async function listOpportunities(actor: Actor, query: { q?: string; stage?: string; page?: number; pageSize?: number; open?: boolean }) {
  requirePermission(actor, "opportunities.view");
  await ensureRoleTemplates();
  const page = Math.max(1, query.page ?? 1);
  const size = Math.min(200, Math.max(1, query.pageSize ?? PAGE));
  const q = query.q?.trim().toLowerCase();
  const where = {
    organizationId: actor.organizationId,
    archivedAt: null,
    ...(can(actor, "reports.view") || can(actor, "leads.assign") ? {} : { ownerId: actor.userId }),
    ...(query.stage ? { stage: query.stage } : query.open ? { stage: { notIn: ["won", "lost"] } } : {}),
    ...(q ? { searchText: { contains: q } } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.opportunity.count({ where }),
    prisma.opportunity.findMany({ where, orderBy: [{ expectedCloseOn: "asc" }, { updatedAt: "desc" }], skip: (page - 1) * size, take: size, include: { customer: { select: { id: true, name: true } }, owner: { select: { name: true, status: true } } } }),
  ]);
  return { items, page, pageSize: size, total };
}

export async function transitionOpportunity(actor: Actor, id: string, stage: string, reason: string, override = false) {
  requirePermission(actor, "opportunities.edit");
  const opportunity = await prisma.opportunity.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!opportunity) throw notFound("Opportunity not found.");
  if (opportunity.archivedAt) throw conflict("Archived opportunities are read-only.");
  if (stage === opportunity.stage) throw validationError(`This opportunity is already in ${stage}. Choose a different stage.`);
  if (stage === "lost" && cleanText(reason, 500).length < 3) throw validationError("Give a reason when marking an opportunity lost.", { reason: "Required." });
  const allowed = canTransition(OPPORTUNITY_TRANSITIONS, opportunity.stage, stage);
  if (!allowed && !override) throw validationError(`Cannot move this opportunity from ${opportunity.stage} to ${stage}.`);
  if (!allowed && override && !can(actor, "leads.assign")) throw forbidden("An authorized manager must record an override.");
  if (!allowed && cleanText(reason, 500).length < 3) throw validationError("Record why this stage change overrides the pipeline rules.");
  const updated = await prisma.opportunity.updateMany({
    where: { id, version: opportunity.version },
    data: { stage, probability: STAGE_PROBABILITY[stage] ?? opportunity.probability, lostReason: stage === "lost" ? cleanText(reason, 500) : opportunity.lostReason, closedAt: stage === "won" || stage === "lost" ? new Date() : null, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw conflict("Someone else changed this opportunity. Refresh and try again.");
  await prisma.opportunityEvent.create({ data: { opportunityId: id, fromStage: opportunity.stage, toStage: stage, reason: cleanText(reason, 500), actorId: actor.userId, actorName: actor.name, override: !allowed } });
  await writeAudit(prisma, actor, { action: "opportunity.stage", entityType: "opportunity", entityId: id, before: { stage: opportunity.stage }, after: { stage, reason, override: !allowed } });
  if (opportunity.ownerId && opportunity.ownerId !== actor.userId) {
    const owner = await prisma.user.findFirst({ where: { id: opportunity.ownerId, organizationId: actor.organizationId, status: "active" } });
    if (owner) {
      await notifyUser(prisma, { organizationId: actor.organizationId, userId: owner.id, type: "opportunity.stage", title: `${opportunity.name} is ${stage}`, body: `${actor.name} moved it from ${opportunity.stage}.`, href: "/opportunities", dedupeKey: `opp.stage:${id}:${opportunity.version + 1}`, email: { to: owner.email, template: "opportunity_stage", payload: { opportunity: opportunity.name, from: opportunity.stage, stage, url: appUrl("/opportunities") } } });
      scheduleOutbox();
    }
  }
  return { stage, project: stage === "won" ? await startWonProject(actor, id) : null };
}

export type WonProject = { id: string; code: string; created: boolean } | { skipped: string };

async function startWonProject(actor: Actor, opportunityId: string): Promise<WonProject> {
  if (!can(actor, "projects.create")) return { skipped: "You don't have permission to create projects, so a project manager needs to start it." };
  try {
    const result = await startProjectFromOpportunity(actor, opportunityId, {});
    const project = await prisma.project.findUniqueOrThrow({ where: { id: result.id }, select: { id: true, code: true } });
    return { ...project, created: !result.replayed };
  } catch (error) {
    if (error instanceof AppError) return { skipped: error.message };
    throw error;
  }
}

export async function getOpportunity(actor: Actor, id: string) {
  requirePermission(actor, "opportunities.view");
  const opportunity = await prisma.opportunity.findFirst({
    where: { id, organizationId: actor.organizationId, ...(can(actor, "reports.view") || can(actor, "leads.assign") ? {} : { ownerId: actor.userId }) },
    include: {
      customer: { select: { id: true, name: true, code: true } },
      owner: { select: { name: true, status: true } },
      contact: { select: { name: true, email: true } },
      lead: { select: { id: true, code: true, name: true } },
      events: { orderBy: { createdAt: "desc" }, take: 30 },
      activities: { orderBy: { dueAt: "asc" }, take: 20, include: { owner: { select: { name: true } } } },
    },
  });
  if (!opportunity) throw notFound("Opportunity not found.");
  return opportunity;
}

export async function archiveOpportunity(actor: Actor, id: string, restore = false) {
  requirePermission(actor, "opportunities.edit");
  const opportunity = await prisma.opportunity.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!opportunity) throw notFound("Opportunity not found.");
  await prisma.opportunity.update({ where: { id }, data: { archivedAt: restore ? null : new Date() } });
  await writeAudit(prisma, actor, { action: restore ? "opportunity.restore" : "opportunity.archive", entityType: "opportunity", entityId: id, before: { archivedAt: opportunity.archivedAt }, after: { archivedAt: restore ? null : "archived" } });
}

export async function forecast(actor: Actor) {
  requirePermission(actor, "opportunities.view");
  const rows = await prisma.opportunity.findMany({
    where: { organizationId: actor.organizationId, archivedAt: null, ...(can(actor, "reports.view") || can(actor, "leads.assign") ? {} : { ownerId: actor.userId }) },
    select: { id: true, stage: true, valueCents: true, probability: true, currency: true, expectedCloseOn: true, createdAt: true, closedAt: true },
  });
  const open = rows.filter((row) => row.stage !== "won" && row.stage !== "lost");
  const won = rows.filter((row) => row.stage === "won");
  const lost = rows.filter((row) => row.stage === "lost");
  const pipelineCents = open.reduce((sum, row) => sum + row.valueCents, 0);
  const weightedCents = open.reduce((sum, row) => sum + Math.round(row.valueCents * row.probability / 100), 0);
  const stages = new Map<string, { count: number; cents: number }>();
  for (const row of open) {
    const current = stages.get(row.stage) ?? { count: 0, cents: 0 };
    current.count += 1;
    current.cents += row.valueCents;
    stages.set(row.stage, current);
  }
  const decided = won.length + lost.length;
  return {
    currency: actor.currency,
    pipelineCents,
    weightedCents,
    openCount: open.length,
    wonCount: won.length,
    lostCount: lost.length,
    winRate: decided ? Math.round((won.length / decided) * 100) : null,
    stages: [...stages.entries()].map(([stage, value]) => ({ stage, ...value })),
  };
}

export async function createCampaign(actor: Actor, input: { name: string; channel: string; source?: string; audience?: string; startsOn?: string; endsOn?: string; budgetCents?: number; goal?: string }) {
  requirePermission(actor, "campaigns.manage");
  const name = cleanText(input.name, 120);
  if (name.length < 2) throw validationError("Name the campaign.");
  return prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, actor.organizationId, "campaign", "CMP");
    return tx.campaign.create({
      data: { organizationId: actor.organizationId, code, name, channel: input.channel || "other", source: input.source, audience: cleanText(input.audience ?? "", 300), startsOn: input.startsOn || null, endsOn: input.endsOn || null, budgetCents: input.budgetCents ?? null, currency: actor.currency, ownerId: actor.userId, goal: cleanText(input.goal ?? "", 300), status: "active" },
    });
  });
}

export async function listCampaigns(actor: Actor) {
  requirePermission(actor, "campaigns.view");
  await ensureRoleTemplates();
  const campaigns = await prisma.campaign.findMany({ where: { organizationId: actor.organizationId, archivedAt: null }, orderBy: { createdAt: "desc" }, take: 50 });
  const reports = [];
  for (const campaign of campaigns) {
    const [leads, qualified, opportunities, won] = await Promise.all([
      prisma.lead.count({ where: { campaignId: campaign.id } }),
      prisma.lead.count({ where: { campaignId: campaign.id, status: { in: ["qualified", "converted"] } } }),
      prisma.opportunity.count({ where: { campaignId: campaign.id } }),
      prisma.opportunity.aggregate({ where: { campaignId: campaign.id, stage: "won" }, _sum: { valueCents: true }, _count: { _all: true } }),
    ]);
    const costPerLead = campaign.budgetCents && leads ? Math.round(campaign.budgetCents / leads) : null;
    const costPerQualified = campaign.budgetCents && qualified ? Math.round(campaign.budgetCents / qualified) : null;
    reports.push({ ...campaign, leads, qualified, opportunities, wonCount: won._count._all, wonCents: won._sum.valueCents ?? 0, costPerLead, costPerQualified });
  }
  return reports;
}

export async function createCrmActivity(actor: Actor, input: { leadId?: string; opportunityId?: string; customerId?: string; type: string; subject: string; notes?: string; dueAt?: string; priority?: string; recurrence?: string }) {
  requirePermission(actor, "leads.edit");
  const subject = cleanText(input.subject, 160);
  if (subject.length < 2) throw validationError("Describe the activity.");
  const allowed = ["call", "email", "meeting", "follow_up", "task", "note", "demo", "proposal", "visit"];
  if (!allowed.includes(input.type)) throw validationError("Choose an activity type.");
  const recurrence = input.recurrence === "weekly" || input.recurrence === "monthly" ? input.recurrence : "none";
  if (input.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: input.leadId, organizationId: actor.organizationId, ...leadScope(actor) } });
    if (!lead) throw notFound("Lead not found.");
  }
  const dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (input.dueAt && dueAt && Number.isNaN(dueAt.getTime())) throw validationError("Choose a valid due time.");
  const activity = await prisma.crmActivity.create({
    data: { organizationId: actor.organizationId, leadId: input.leadId, opportunityId: input.opportunityId, customerId: input.customerId, ownerId: actor.userId, type: input.type, subject, notes: cleanText(input.notes ?? "", 4000), dueAt, priority: input.priority || "medium", recurrence, status: input.type === "note" ? "done" : "open", completedAt: input.type === "note" ? new Date() : null },
  });
  if (input.leadId && dueAt && input.type === "follow_up") {
    await prisma.lead.update({ where: { id: input.leadId }, data: { nextFollowUpAt: dueAt, lastActivityAt: new Date() } });
  } else if (input.leadId) {
    await prisma.lead.update({ where: { id: input.leadId }, data: { lastActivityAt: new Date() } });
    await scoreAndStore(actor.organizationId, input.leadId);
  }
  await writeActivity(prisma, actor, { type: `crm.${input.type}`, summary: subject, entityType: "lead", entityId: input.leadId, customerId: input.customerId });
  return activity;
}

export async function completeCrmActivity(actor: Actor, id: string) {
  requirePermission(actor, "leads.edit");
  const activity = await prisma.crmActivity.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!activity) throw notFound("Activity not found.");
  if (activity.status === "done") return activity;
  await prisma.crmActivity.update({ where: { id }, data: { status: "done", completedAt: new Date() } });
  if (activity.recurrence !== "none" && activity.dueAt) {
    const existing = await prisma.crmActivity.count({ where: { seriesId: activity.seriesId ?? activity.id, status: "open" } });
    if (existing === 0) {
      const next = new Date(activity.dueAt);
      if (activity.recurrence === "weekly") next.setUTCDate(next.getUTCDate() + 7);
      if (activity.recurrence === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
      await prisma.crmActivity.create({
        data: { organizationId: activity.organizationId, leadId: activity.leadId, opportunityId: activity.opportunityId, customerId: activity.customerId, ownerId: activity.ownerId, type: activity.type, subject: activity.subject, priority: activity.priority, dueAt: next, recurrence: activity.recurrence, seriesId: activity.seriesId ?? activity.id, status: "open" },
      });
      if (activity.leadId && activity.type === "follow_up") await prisma.lead.update({ where: { id: activity.leadId }, data: { nextFollowUpAt: next } });
    }
  } else if (activity.leadId && activity.type === "follow_up") {
    const upcoming = await prisma.crmActivity.findFirst({ where: { leadId: activity.leadId, type: "follow_up", status: "open", dueAt: { not: null } }, orderBy: { dueAt: "asc" } });
    await prisma.lead.update({ where: { id: activity.leadId }, data: { nextFollowUpAt: upcoming?.dueAt ?? null, lastActivityAt: new Date() } });
  }
  if (activity.leadId) await scoreAndStore(actor.organizationId, activity.leadId);
}

export async function findLeadDuplicates(actor: Actor, input: { email?: string | null; phone?: string | null; domain?: string | null; excludeId?: string }) {
  requirePermission(actor, "leads.view");
  const email = input.email?.trim().toLowerCase() || undefined;
  const phone = normalizePhone(input.phone);
  const domain = input.domain?.trim().toLowerCase() || undefined;
  if (!email && !phone && !domain) return [];
  const or = [...(email ? [{ email }] : []), ...(domain ? [{ domain }] : [])];
  const leads = or.length === 0 ? [] : await prisma.lead.findMany({
    where: {
      organizationId: actor.organizationId,
      mergedIntoId: null,
      id: input.excludeId ? { not: input.excludeId } : undefined,
      OR: or,
    },
    take: 8,
    select: { id: true, code: true, name: true, email: true, company: true, phone: true, status: true },
  });
  const phoneMatches = phone
    ? (await prisma.lead.findMany({ where: { organizationId: actor.organizationId, mergedIntoId: null, phone: { not: null }, id: input.excludeId ? { not: input.excludeId } : undefined }, take: 50, select: { id: true, code: true, name: true, email: true, company: true, phone: true, status: true } })).filter((lead) => normalizePhone(lead.phone) === phone)
    : [];
  const contacts = email ? await prisma.contact.findMany({ where: { organizationId: actor.organizationId, email, archivedAt: null }, take: 5, select: { id: true, name: true, email: true, customerId: true } }) : [];
  const seen = new Set<string>();
  const leadMatches = [...leads, ...phoneMatches].filter((lead) => (seen.has(lead.id) ? false : (seen.add(lead.id), true))).map((lead) => ({ kind: "lead" as const, id: lead.id, code: lead.code, name: lead.name, email: lead.email, company: lead.company, phone: lead.phone, status: lead.status }));
  const contactMatches = contacts.map((contact) => ({ kind: "contact" as const, id: contact.id, code: "", name: contact.name, email: contact.email, company: "", phone: null, status: "contact" }));
  return [...leadMatches, ...contactMatches];
}

export async function mergeLeads(actor: Actor, sourceId: string, targetId: string) {
  requirePermission(actor, "leads.merge");
  if (sourceId === targetId) throw validationError("Choose two different leads.");
  await prisma.$transaction(async (tx) => {
    const source = await tx.lead.findFirst({ where: { id: sourceId, organizationId: actor.organizationId, mergedIntoId: null } });
    const target = await tx.lead.findFirst({ where: { id: targetId, organizationId: actor.organizationId, mergedIntoId: null } });
    if (!source || !target) throw notFound("Lead not found.");
    await tx.leadAssignment.updateMany({ where: { leadId: sourceId }, data: { leadId: targetId } });
    await tx.crmActivity.updateMany({ where: { leadId: sourceId }, data: { leadId: targetId } });
    await tx.opportunity.updateMany({ where: { leadId: sourceId }, data: { leadId: targetId } });
    await tx.reminder.updateMany({ where: { leadId: sourceId }, data: { leadId: targetId } });
    await tx.leadScoreEvent.updateMany({ where: { leadId: sourceId }, data: { leadId: targetId } });
    await tx.lead.update({ where: { id: sourceId }, data: { status: "archived", archivedAt: new Date(), mergedIntoId: targetId, ownershipStatus: "unassigned" } });
    await tx.lead.update({ where: { id: targetId }, data: { notes: `${target.notes}\n\nMerged from ${source.code}: ${source.notes}`.trim() } });
    await writeAudit(tx, actor, { action: "lead.merge", entityType: "lead", entityId: targetId, before: { sourceId }, after: { targetId } });
  });
  await scoreAndStore(actor.organizationId, targetId);
}

export async function dataQuality(actor: Actor) {
  requirePermission(actor, "leads.assign");
  const now = new Date();
  const scope = { organizationId: actor.organizationId, mergedIntoId: null, archivedAt: null, status: { in: OPEN_LEAD } };
  const [unassigned, noFollowUp, overdue, stale] = await Promise.all([
    prisma.lead.findMany({ where: { ...scope, ownershipStatus: "unassigned" }, take: 20, select: { id: true, code: true, name: true } }),
    prisma.lead.findMany({ where: { ...scope, nextFollowUpAt: null }, take: 20, select: { id: true, code: true, name: true } }),
    prisma.lead.findMany({ where: { ...scope, nextFollowUpAt: { lt: now } }, take: 20, select: { id: true, code: true, name: true, nextFollowUpAt: true } }),
    prisma.lead.findMany({ where: { ...scope, lastActivityAt: null, createdAt: { lt: new Date(Date.now() - 3 * 86_400_000) } }, take: 20, select: { id: true, code: true, name: true } }),
  ]);
  return { unassigned, noFollowUp, overdue, stale };
}

export async function slaBreaches(actor: Actor) {
  requirePermission(actor, "leads.assign");
  await ensureCrmDefaults(actor.organizationId);
  const policies = await prisma.slaPolicy.findMany({ where: { organizationId: actor.organizationId } });
  const leads = await prisma.lead.findMany({ where: { organizationId: actor.organizationId, status: { in: ["new", "contacted"] }, lastActivityAt: null, archivedAt: null, mergedIntoId: null }, take: 100, select: { id: true, code: true, name: true, priority: true, createdAt: true, ownerId: true } });
  return leads.filter((lead) => {
    const policy = policies.find((item) => item.priority === lead.priority);
    if (!policy) return false;
    return Date.now() - lead.createdAt.getTime() > policy.responseMinutes * 60_000;
  });
}

export function parseLeadCsv(raw: string) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 501);
  if (lines.length < 2) throw validationError("The file needs a header and at least one row.");
  if (lines.length > 501) throw validationError("Import at most 500 leads at a time.");
  const headers = splitCsv(lines[0]!).map((header) => header.toLowerCase());
  const required = ["name"];
  if (!required.every((header) => headers.includes(header))) throw validationError("The file must include a name column.");
  return lines.slice(1).map((line, index) => {
    const cells = splitCsv(line);
    const row: Record<string, string> = {};
    headers.forEach((header, cell) => { row[header] = cells[cell] ?? ""; });
    return { line: index + 2, name: row.name ?? "", email: row.email ?? "", company: row.company ?? "", phone: row.phone ?? "", source: row.source ?? "" };
  });
}

export async function previewLeadImport(actor: Actor, raw: string) {
  requirePermission(actor, "crm.import");
  const rows = parseLeadCsv(raw);
  const preview = [];
  for (const row of rows.slice(0, 50)) {
    const email = row.email.trim().toLowerCase();
    const duplicate = email ? await prisma.lead.findFirst({ where: { organizationId: actor.organizationId, email, mergedIntoId: null }, select: { id: true, code: true } }) : null;
    const error = row.name.trim().length < 2 ? "Name is required." : email && !email.includes("@") ? "Email is not valid." : "";
    preview.push({ ...row, duplicate: duplicate?.code ?? null, error });
  }
  return { total: rows.length, preview };
}

export async function commitLeadImport(actor: Actor, raw: string) {
  requirePermission(actor, "crm.import");
  const rows = parseLeadCsv(raw);
  let created = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const row of rows) {
    if (row.name.trim().length < 2) { failed += 1; errors.push(`Line ${row.line}: name is required.`); continue; }
    const email = row.email.trim().toLowerCase();
    if (email && !email.includes("@")) { failed += 1; errors.push(`Line ${row.line}: email is not valid.`); continue; }
    if (email) {
      const duplicate = await prisma.lead.findFirst({ where: { organizationId: actor.organizationId, email, mergedIntoId: null }, select: { id: true } });
      if (duplicate) { skipped += 1; continue; }
    }
    const code = await nextCode(prisma, actor.organizationId, "lead", "LED");
    const createdLead = await prisma.lead.create({
      data: {
        organizationId: actor.organizationId,
        code,
        name: cleanText(row.name, 160),
        company: cleanText(row.company, 160),
        email: email || null,
        phone: row.phone.trim() || null,
        domain: email.includes("@") ? email.split("@")[1] : null,
        source: row.source || null,
        ownerId: actor.userId,
        salesOwnerId: actor.userId,
        ownershipStatus: "assigned",
        assignedAt: new Date(),
        assignedById: actor.userId,
        assignmentReason: "Imported",
        searchText: searchBlob([row.name, row.company, email, row.phone, code]),
      },
    });
    await prisma.leadAssignment.create({ data: { organizationId: actor.organizationId, leadId: createdLead.id, toUserId: actor.userId, assignmentType: "assign", reason: "Imported", actorId: actor.userId, actorName: actor.name } });
    await scoreAndStore(actor.organizationId, createdLead.id);
    created += 1;
  }
  await prisma.importBatch.create({ data: { organizationId: actor.organizationId, actorId: actor.userId, actorName: actor.name, status: "completed", summary: JSON.stringify({ created, skipped, failed }) } });
  await writeAudit(prisma, actor, { action: "lead.import", entityType: "lead", entityId: actor.organizationId, metadata: { created, skipped, failed } });
  return { created, skipped, failed, errors: errors.slice(0, 20) };
}

export async function defineCustomField(actor: Actor, input: { entityType: string; key: string; label: string; fieldType: string; options?: string[] }) {
  requirePermission(actor, "settings.manage");
  if (!["lead", "customer", "opportunity"].includes(input.entityType)) throw validationError("Choose a record type.");
  if (!/^[a-z][a-z0-9_]{1,32}$/.test(input.key)) throw validationError("Use a short lowercase key.");
  if (!["text", "number", "date", "select"].includes(input.fieldType)) throw validationError("Choose a field type.");
  return prisma.customFieldDefinition.upsert({
    where: { organizationId_entityType_key: { organizationId: actor.organizationId, entityType: input.entityType, key: input.key } },
    create: { organizationId: actor.organizationId, entityType: input.entityType, key: input.key, label: cleanText(input.label, 80), fieldType: input.fieldType, options: JSON.stringify(input.options ?? []) },
    update: { label: cleanText(input.label, 80), enabled: true },
  });
}

export async function ensureCrmDefaults(organizationId: string) {
  const existing = await prisma.leadScoreRule.count({ where: { organizationId } });
  if (existing === 0) {
    await prisma.leadScoreRule.createMany({ data: DEFAULT_RULES.map((rule) => ({ organizationId, ...rule })) });
  }
  const sla = await prisma.slaPolicy.count({ where: { organizationId } });
  if (sla === 0) {
    await prisma.slaPolicy.createMany({ data: [{ organizationId, priority: "critical", responseMinutes: 60 }, { organizationId, priority: "high", responseMinutes: 240 }, { organizationId, priority: "medium", responseMinutes: 1440 }, { organizationId, priority: "low", responseMinutes: 4320 }] });
  }
}

export async function runLeadAutomation(actor: Actor, leadId: string, event: string) {
  const rules = await prisma.automationRule.findMany({ where: { organizationId: actor.organizationId, event, enabled: true } });
  for (const rule of rules) {
    const dedupeKey = `auto:${rule.id}:${leadId}`;
    const seen = await prisma.automationRun.findUnique({ where: { dedupeKey } });
    if (seen) continue;
    if (rule.action === "notify_owner") {
      const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: actor.organizationId } });
      if (lead?.ownerId) {
        await notifyUser(prisma, { organizationId: actor.organizationId, userId: lead.ownerId, type: "lead.automation", title: lead.name, body: rule.name, href: `/leads/${lead.id}`, dedupeKey });
      }
      await prisma.automationRun.create({ data: { ruleId: rule.id, dedupeKey, status: "done", detail: "notified" } });
    } else {
      await prisma.automationRun.create({ data: { ruleId: rule.id, dedupeKey, status: "skipped", detail: "unsupported action" } });
    }
  }
}

function presentLead<T extends { scoreExplanation: string }>(lead: T) {
  return { ...lead, reasons: parseStringArray(lead.scoreExplanation) };
}

function parseJson(value: string) {
  try { return JSON.parse(value) as unknown; } catch { return {}; }
}

function parseStringArray(value: string) {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function normalizePhone(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/[^\d+]/g, "");
}

function splitCsv(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { cells.push(current.trim()); current = ""; continue; }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

export { createCustomer, addContact };
