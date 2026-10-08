import type { PrismaClient } from "@prisma/client";
import { ROLE_TEMPLATES } from "@/lib/permissions";
import { ONBOARDING_STEPS } from "@/lib/domain/workflow";

type Db = PrismaClient;

const LOOKUPS: Array<[string, string, string, boolean, string]> = [
  ["project_status", "draft", "Draft", true, '{"category":"open"}'],
  ["project_status", "proposed", "Proposed", false, '{"category":"open"}'],
  ["project_status", "approved", "Approved", false, '{"category":"open"}'],
  ["project_status", "onboarding", "Onboarding", false, '{"category":"open"}'],
  ["project_status", "planning", "Planning", false, '{"category":"open"}'],
  ["project_status", "active", "Active", true, '{"category":"open"}'],
  ["project_status", "on_hold", "On hold", false, '{"category":"hold"}'],
  ["project_status", "blocked", "Blocked", false, '{"category":"hold"}'],
  ["project_status", "completed", "Completed", true, '{"category":"done"}'],
  ["project_status", "delivered", "Delivered", false, '{"category":"done"}'],
  ["project_status", "cancelled", "Cancelled", true, '{"category":"cancelled"}'],
  ["project_status", "archived", "Archived", true, '{"category":"archived"}'],
  ["customer_status", "lead", "Lead", false, "{}"],
  ["customer_status", "qualified", "Qualified", false, "{}"],
  ["customer_status", "opportunity", "Opportunity", false, "{}"],
  ["customer_status", "proposal", "Proposal", false, "{}"],
  ["customer_status", "negotiation", "Negotiation", false, "{}"],
  ["customer_status", "onboarding", "Onboarding", false, "{}"],
  ["customer_status", "active", "Active", true, "{}"],
  ["customer_status", "completed", "Completed", false, "{}"],
  ["customer_status", "inactive", "Inactive", false, "{}"],
  ["customer_status", "archived", "Archived", true, "{}"],
  ["lead_status", "new", "New", true, "{}"],
  ["lead_status", "contacted", "Contacted", false, "{}"],
  ["lead_status", "qualified", "Qualified", false, "{}"],
  ["lead_status", "unqualified", "Unqualified", false, "{}"],
  ["lead_status", "working", "Working", false, "{}"],
  ["lead_status", "nurturing", "Nurturing", false, "{}"],
  ["lead_status", "dormant", "Dormant", false, "{}"],
  ["lead_status", "lost", "Lost", false, "{}"],
  ["lead_status", "converted", "Converted", true, "{}"],
  ["lead_status", "archived", "Archived", true, "{}"],
  ["task_status", "backlog", "Backlog", true, "{}"],
  ["task_status", "ready", "Ready", false, "{}"],
  ["task_status", "in_progress", "In progress", true, "{}"],
  ["task_status", "blocked", "Blocked", false, "{}"],
  ["task_status", "in_review", "In review", false, "{}"],
  ["task_status", "done", "Done", true, "{}"],
  ["task_status", "cancelled", "Cancelled", true, "{}"],
  ["priority", "low", "Low", true, "{}"],
  ["priority", "medium", "Medium", true, "{}"],
  ["priority", "high", "High", true, "{}"],
  ["priority", "critical", "Critical", true, "{}"],
  ["industry", "software", "Software", false, "{}"],
  ["industry", "healthcare", "Healthcare", false, "{}"],
  ["industry", "finance", "Finance", false, "{}"],
  ["industry", "retail", "Retail", false, "{}"],
  ["industry", "education", "Education", false, "{}"],
  ["industry", "manufacturing", "Manufacturing", false, "{}"],
  ["industry", "professional_services", "Professional services", false, "{}"],
  ["industry", "other", "Other", false, "{}"],
  ["lead_source", "website", "Website", false, "{}"],
  ["lead_source", "referral", "Referral", false, "{}"],
  ["lead_source", "outbound", "Outbound", false, "{}"],
  ["lead_source", "event", "Event", false, "{}"],
  ["lead_source", "partner", "Partner", false, "{}"],
  ["lead_source", "other", "Other", false, "{}"],
  ["customer_category", "enterprise", "Enterprise", false, "{}"],
  ["customer_category", "mid_market", "Mid-market", false, "{}"],
  ["customer_category", "small_business", "Small business", false, "{}"],
  ["customer_category", "individual", "Individual", false, "{}"],
  ["document_category", "proposal", "Proposal", false, "{}"],
  ["document_category", "srs", "SRS / specification", false, "{}"],
  ["document_category", "design", "Design", false, "{}"],
  ["document_category", "contract", "Contract", false, "{}"],
  ["document_category", "deliverable", "Deliverable", false, "{}"],
  ["document_category", "general", "General", true, "{}"],
  ["requirement_status", "draft", "Draft", true, "{}"],
  ["requirement_status", "proposed", "Proposed", false, "{}"],
  ["requirement_status", "approved", "Approved", true, "{}"],
  ["requirement_status", "rejected", "Rejected", false, "{}"],
  ["requirement_status", "implemented", "Implemented", false, "{}"],
  ["requirement_status", "verified", "Verified", false, "{}"],
  ["requirement_status", "deferred", "Deferred", false, "{}"],
  ["change_status", "requested", "Requested", true, "{}"],
  ["change_status", "under_review", "Under review", false, "{}"],
  ["change_status", "approved", "Approved", false, "{}"],
  ["change_status", "rejected", "Rejected", false, "{}"],
  ["change_status", "scheduled", "Scheduled", false, "{}"],
  ["change_status", "implemented", "Implemented", false, "{}"],
  ["change_status", "verified", "Verified", false, "{}"],
  ["change_status", "closed", "Closed", true, "{}"],
  ["milestone_status", "planned", "Planned", true, "{}"],
  ["milestone_status", "in_progress", "In progress", false, "{}"],
  ["milestone_status", "blocked", "Blocked", false, "{}"],
  ["milestone_status", "completed", "Completed", true, "{}"],
  ["milestone_status", "cancelled", "Cancelled", false, "{}"],
];

export async function provisionOrganization(
  db: Db,
  input: { name: string; slug: string; timezone?: string; currency?: string; locale?: string },
) {
  const organization = await db.organization.create({
    data: {
      name: input.name,
      slug: input.slug,
      timezone: input.timezone ?? "UTC",
      currency: input.currency ?? "USD",
      locale: input.locale ?? "en-US",
    },
  });

  for (const [key, template] of Object.entries(ROLE_TEMPLATES)) {
    await db.role.create({
      data: {
        organizationId: organization.id,
        key,
        name: template.name,
        description: template.description,
        system: true,
        permissions: { create: template.permissions.map((permission) => ({ permission })) },
      },
    });
  }

  for (const [index, [kind, key, label, system, meta]] of LOOKUPS.entries()) {
    await db.lookupOption.create({
      data: {
        organizationId: organization.id,
        kind,
        key,
        label,
        system,
        meta,
        sort: index,
        color: kind.endsWith("status") || kind === "priority" ? key : "neutral",
      },
    });
  }

  for (const [index, [key, label, required]] of ONBOARDING_STEPS.entries()) {
    await db.onboardingTemplate.create({
      data: {
        organizationId: organization.id,
        key,
        label,
        required,
        sort: index,
        description: "",
      },
    });
  }

  await db.department.createMany({
    data: ["Delivery", "Design", "Sales", "Finance", "Operations"].map((name) => ({
      organizationId: organization.id,
      name,
    })),
  });

  return organization;
}

let rolesReady: Promise<void> | null = null;

/** Fills in permissions added to a role template after the organization was created. One read and at most one write. */
export function ensureRoleTemplates() {
  rolesReady ??= syncRoleTemplates().catch((error: unknown) => {
    rolesReady = null;
    throw error;
  });
  return rolesReady;
}

async function syncRoleTemplates() {
  const { prisma } = await import("@/lib/db");
  const roles = await prisma.role.findMany({ where: { system: true }, select: { id: true, key: true, permissions: { select: { permission: true } } } });
  const missing: { roleId: string; permission: string }[] = [];
  for (const role of roles) {
    const template = ROLE_TEMPLATES[role.key];
    if (!template) continue;
    const held = new Set(role.permissions.map((item) => item.permission));
    for (const permission of template.permissions) if (!held.has(permission)) missing.push({ roleId: role.id, permission });
  }
  if (missing.length) await prisma.rolePermission.createMany({ data: missing, skipDuplicates: true });
}

function highest(codes: Array<{ code: string }>) {
  return codes.reduce((max, { code }) => Math.max(max, Number(code.split("-").pop()) || 0), 0);
}

export async function syncSequences(db: PrismaClient, organizationId: string) {
  const where = { organizationId };
  const [leads, customers, projects, opportunities, campaigns, tasks, milestones, requirements, changes] = await Promise.all([
    db.lead.findMany({ where, select: { code: true } }),
    db.customer.findMany({ where, select: { code: true } }),
    db.project.findMany({ where, select: { code: true } }),
    db.opportunity.findMany({ where, select: { code: true } }),
    db.campaign.findMany({ where, select: { code: true } }),
    db.task.findMany({ where, select: { projectId: true, code: true } }),
    db.milestone.findMany({ where, select: { projectId: true, code: true } }),
    db.requirement.findMany({ where, select: { projectId: true, code: true } }),
    db.changeRequest.findMany({ where, select: { projectId: true, code: true } }),
  ]);
  const targets = new Map<string, number>([
    ["lead", highest(leads)],
    ["customer", highest(customers)],
    ["project", highest(projects)],
    ["opportunity", highest(opportunities)],
    ["campaign", highest(campaigns)],
  ]);
  for (const [kind, rows] of [["task", tasks], ["milestone", milestones], ["requirement", requirements], ["change", changes]] as const) {
    const byProject = new Map<string, Array<{ code: string }>>();
    for (const row of rows) byProject.set(row.projectId, [...(byProject.get(row.projectId) ?? []), row]);
    for (const [projectId, list] of byProject) targets.set(`${kind}:${projectId}`, highest(list));
  }
  for (const [name, value] of targets) {
    if (value === 0) continue;
    const current = await db.sequence.findUnique({ where: { organizationId_name: { organizationId, name } } });
    if (!current) await db.sequence.create({ data: { organizationId, name, value } });
    else if (current.value < value) await db.sequence.update({ where: { id: current.id }, data: { value } });
  }
}

export const LOCKED_LOOKUP_KEYS = new Set([
  "project_status:draft",
  "project_status:active",
  "project_status:completed",
  "project_status:archived",
  "project_status:cancelled",
  "customer_status:active",
  "customer_status:archived",
  "task_status:backlog",
  "task_status:in_progress",
  "task_status:done",
  "task_status:cancelled",
  "priority:low",
  "priority:medium",
  "priority:high",
  "priority:critical",
]);
