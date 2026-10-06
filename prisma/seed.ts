import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { provisionOrganization, syncSequences } from "../lib/domain/bootstrap";
import type { Actor } from "../lib/actor";
import { createSrsDraft, updateSrsSettings } from "../lib/domain/srs/core";
import { addCriterion, createItem, generateFromAnswers, saveAnswer } from "../lib/domain/srs/content";
import { addSrsComment, transitionSrs } from "../lib/domain/srs/workflow";

const prisma = new PrismaClient();
const PASSWORD = "Harbor!2026";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW !== "1") {
    throw new Error("Refusing to seed production. Set SEED_ALLOW=1 to override.");
  }
  const existing = await prisma.organization.findUnique({ where: { slug: "elec" } });
  if (existing) {
    await backfillSrs(existing.id);
    console.info("Seed already present.");
    return;
  }
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const elec = await provisionOrganization(prisma, { name: "Elec Studio", slug: "elec", timezone: "America/New_York", currency: "USD", locale: "en-US" });
  const other = await provisionOrganization(prisma, { name: "Northline", slug: "northline", timezone: "Europe/Berlin", currency: "EUR", locale: "de-DE" });

  async function user(orgId: string, email: string, name: string, role: string, extra: Record<string, string | null> = {}) {
    const roleRow = await prisma.role.findFirstOrThrow({ where: { organizationId: orgId, key: role } });
    return prisma.user.create({
      data: {
        organizationId: orgId,
        email,
        name,
        passwordHash,
        kind: role === "customer" ? "customer" : "employee",
        status: extra.status ?? "active",
        jobTitle: extra.jobTitle,
        emailVerifiedAt: new Date(),
        deactivatedAt: extra.status === "inactive" ? new Date() : null,
        customerId: extra.customerId,
        roles: { create: { roleId: roleRow.id } },
      },
    });
  }

  const ada = await user(elec.id, "ada@elec.test", "Ada Okonkwo", "owner", { jobTitle: "Founder" });
  const mira = await user(elec.id, "mira@elec.test", "Mira Chen", "project_manager", { jobTitle: "Delivery lead" });
  const leo = await user(elec.id, "leo@elec.test", "Leo Martins", "account_manager", { jobTitle: "Account manager" });
  const noah = await user(elec.id, "noah@elec.test", "Noah Ibrahim", "developer", { jobTitle: "Engineer" });
  await user(elec.id, "quinn@elec.test", "Quinn Alvarez", "qa", { jobTitle: "QA" });
  await user(elec.id, "faye@elec.test", "Faye Rossi", "finance", { jobTitle: "Finance" });
  await user(elec.id, "iris@elec.test", "Iris Patel", "developer", { jobTitle: "Engineer", status: "inactive" });
  await user(other.id, "other@northline.test", "Other Owner", "owner", { jobTitle: "Owner" });

  const northwind = await prisma.customer.create({
    data: { organizationId: elec.id, code: "CUS-0001", name: "Northwind Analytics", status: "active", industry: "software", source: "referral", category: "mid_market", accountManagerId: leo.id, notes: "Multi-year analytics platform.", searchText: "northwind analytics cus-0001 software" },
  });
  const brightline = await prisma.customer.create({
    data: { organizationId: elec.id, code: "CUS-0002", name: "Brightline Health", status: "onboarding", industry: "healthcare", source: "website", category: "enterprise", accountManagerId: leo.id, searchText: "brightline health cus-0002 healthcare" },
  });
  await prisma.customer.create({
    data: { organizationId: elec.id, code: "CUS-0003", name: "Harbor & Co", status: "proposal", industry: "professional_services", source: "event", category: "small_business", accountManagerId: leo.id, searchText: "harbor & co cus-0003" },
  });
  await prisma.customer.create({
    data: { organizationId: elec.id, code: "CUS-0004", name: "Closed Ledger", status: "archived", statusBeforeArchive: "inactive", archivedAt: new Date(), industry: "finance", searchText: "closed ledger cus-0004" },
  });
  const foreign = await prisma.customer.create({
    data: { organizationId: other.id, code: "CUS-0001", name: "Foreign Customer", status: "active", searchText: "foreign customer" },
  });

  const priyaContact = await prisma.contact.create({
    data: { organizationId: elec.id, customerId: northwind.id, name: "Priya Shah", email: "priya@northwind.test", title: "Product owner", isPrimary: true, portalAccess: true, searchText: "priya shah northwind" },
  });
  await prisma.contact.create({
    data: { organizationId: elec.id, customerId: northwind.id, name: "Evan Brooks", email: "evan@northwind.test", title: "Finance", searchText: "evan brooks northwind" },
  });
  const priya = await user(elec.id, "priya@northwind.test", "Priya Shah", "customer", { customerId: northwind.id });
  await prisma.contact.update({ where: { id: priyaContact.id }, data: {} });

  await prisma.lead.createMany({
    data: [
      { organizationId: elec.id, code: "LED-0001", name: "Sam Ortiz", company: "Lumen Retail", email: "sam@lumen.test", status: "qualified", source: "outbound", ownerId: leo.id, salesOwnerId: leo.id, ownershipStatus: "assigned", assignedAt: new Date(), assignedById: ada.id, assignmentReason: "Seeded qualified lead", estimatedValueCents: 1800000, priority: "high", searchText: "sam ortiz lumen retail" },
      { organizationId: elec.id, code: "LED-0002", name: "New Website Lead", company: "Paperkite", email: "hello@paperkite.test", status: "new", source: "website", ownerId: leo.id, marketingOwnerId: leo.id, ownershipStatus: "assigned", assignedAt: new Date(), assignedById: ada.id, assignmentReason: "Seeded website lead", searchText: "paperkite" },
      { organizationId: elec.id, code: "LED-0003", name: "Unqualified Inquiry", status: "unqualified", ownerId: leo.id, salesOwnerId: leo.id, ownershipStatus: "assigned", assignedAt: new Date(), assignedById: ada.id, assignmentReason: "Seeded", searchText: "unqualified inquiry" },
      { organizationId: elec.id, code: "LED-0004", name: "Unassigned inquiry", company: "Harbor Goods", email: "hello@harbor.test", status: "new", source: "website", ownershipStatus: "unassigned", priority: "high", searchText: "harbor goods unassigned" },
    ],
  });

  const project = await prisma.project.create({
    data: {
      organizationId: elec.id,
      customerId: northwind.id,
      code: "PRJ-0001",
      name: "Northwind platform",
      summary: "Replace the reporting suite and ship a customer portal.",
      objectives: "Launch reporting, approvals, and a shared document space.",
      scope: "Reporting, role-based access, and a customer portal. Billing integration is out of scope.",
      status: "active",
      priority: "high",
      managerId: mira.id,
      dueOn: "2026-11-15",
      scopeBaselinedAt: new Date("2026-09-01T00:00:00Z"),
      healthScore: 42,
      healthStatus: "at_risk",
      healthReasons: JSON.stringify(["1 overdue critical task", "1 unresolved blocker"]),
      searchText: "northwind platform prj-0001",
      projectType: "saas",
      phases: { create: ["Discovery", "Requirements", "Design", "Development", "QA and testing"].map((name, sort) => ({ organizationId: elec.id, key: name.toLowerCase(), name, sort, status: sort < 3 ? "completed" : "in_progress" })) },
    },
  });
  await prisma.projectMember.createMany({
    data: [
      { projectId: project.id, userId: mira.id, role: "manager" },
      { projectId: project.id, userId: noah.id, role: "contributor" },
      { projectId: project.id, userId: ada.id, role: "reviewer" },
    ],
  });
  await prisma.onboardingItem.createMany({
    data: [
      ["verify_customer", "Verify customer information", true],
      ["assign_contacts", "Assign customer contacts", true],
      ["gather_requirements", "Gather requirements", true],
      ["approve_scope", "Approve scope", true],
      ["assign_team", "Assign the delivery team", true],
      ["plan_milestones", "Plan initial milestones", true],
      ["kickoff", "Hold the project kickoff", true],
    ].map(([key, label, required], sort) => ({ projectId: project.id, templateKey: String(key), label: String(label), required: Boolean(required), sort, done: true, doneAt: new Date(), doneById: mira.id })),
  });
  const milestone = await prisma.milestone.create({
    data: { organizationId: elec.id, projectId: project.id, code: "MS-0001", name: "Beta to Northwind", status: "in_progress", dueOn: "2026-10-20", ownerId: mira.id, customerVisible: true },
  });
  await prisma.milestone.create({
    data: { organizationId: elec.id, projectId: project.id, code: "MS-0002", name: "Discovery complete", status: "completed", dueOn: "2026-08-01", ownerId: mira.id, customerVisible: true, completedAt: new Date("2026-08-01T00:00:00Z") },
  });
  const requirement = await prisma.requirement.create({
    data: { organizationId: elec.id, projectId: project.id, code: "REQ-0001", title: "Role-based project access", description: "Employees see only permitted projects.", acceptance: "A customer cannot open another customer's project.", priority: "critical", status: "approved", baseline: true, ownerId: mira.id, customerVisible: true, searchText: "role-based project access req-0001" },
  });
  await prisma.task.create({
    data: { organizationId: elec.id, projectId: project.id, milestoneId: milestone.id, requirementId: requirement.id, code: "TSK-0001", title: "Enforce project authorization", status: "in_progress", priority: "critical", assigneeId: noah.id, createdById: mira.id, dueOn: "2026-09-28", estimatedMinutes: 480, customerVisible: true, searchText: "enforce project authorization" },
  });
  await prisma.task.create({
    data: { organizationId: elec.id, projectId: project.id, code: "TSK-0002", title: "Waiting on design review", status: "blocked", priority: "high", assigneeId: noah.id, createdById: mira.id, dueOn: "2026-10-08", blockedReason: "Design sign-off is outstanding.", estimatedMinutes: 180, searchText: "waiting on design review" },
  });
  await prisma.changeRequest.create({
    data: { organizationId: elec.id, projectId: project.id, code: "CR-0001", title: "Add scheduled exports", reason: "Northwind asked after the baseline.", scopeImpact: "Adds a new export workflow. Original scope text is unchanged.", status: "under_review", requestedById: ada.id, requesterName: "Ada Okonkwo", estimatedMinutes: 960, currency: "USD" },
  });
  await prisma.projectIssue.create({
    data: { organizationId: elec.id, projectId: project.id, type: "blocker", severity: "high", title: "Staging credentials expired", detail: "Deployment is blocked until the customer rotates the key.", ownerId: mira.id },
  });
  await prisma.comment.create({
    data: { organizationId: elec.id, customerId: northwind.id, projectId: project.id, authorId: noah.id, authorName: "Noah Ibrahim", body: "Authorization checks are in review.", visibility: "internal", entityType: "project", entityId: project.id },
  });
  await prisma.comment.create({
    data: { organizationId: elec.id, customerId: northwind.id, projectId: project.id, authorId: mira.id, authorName: "Mira Chen", body: "Beta is targeted for October 20. We will send the checklist before then.", visibility: "customer", entityType: "project", entityId: project.id },
  });
  await prisma.meeting.create({
    data: { organizationId: elec.id, projectId: project.id, customerId: northwind.id, title: "Kickoff", startsAt: new Date("2026-09-02T14:00:00Z"), agenda: "Confirm scope and contacts", notes: "Priya is the approver.", visibility: "customer", organizerId: mira.id, participantIds: JSON.stringify([mira.id, leo.id]) },
  });
  await prisma.decision.create({
    data: { organizationId: elec.id, projectId: project.id, title: "Portal is customer-visible", detail: "Internal estimates stay off the portal.", visibility: "customer", decidedOn: "2026-09-03", authorId: mira.id, authorName: "Mira Chen" },
  });
  await prisma.activity.createMany({
    data: [
      { organizationId: elec.id, customerId: northwind.id, projectId: project.id, actorId: mira.id, actorName: "Mira Chen", type: "project.status", summary: "Northwind platform moved to active", visibility: "customer" },
      { organizationId: elec.id, customerId: northwind.id, projectId: project.id, actorId: noah.id, actorName: "Noah Ibrahim", type: "task.blocked", summary: "Design review is blocking a task", visibility: "internal" },
    ],
  });
  await prisma.announcement.create({
    data: { organizationId: elec.id, customerId: northwind.id, title: "Beta window", body: "Please review the shared requirements before October 18." },
  });
  await prisma.notification.create({
    data: { organizationId: elec.id, userId: mira.id, type: "task_overdue", title: "Overdue: Enforce project authorization", body: "This critical task is past its due date.", href: `/projects/${project.id}`, dedupeKey: "seed-overdue-task" },
  });
  await prisma.emailMessage.create({
    data: { organizationId: elec.id, toEmail: "mira@elec.test", template: "task_overdue", payload: "{}", status: "failed", attempts: 2, lastError: "Email is not configured.", dedupeKey: "seed-email-failed", mandatory: false },
  });

  const brightlineProject = await prisma.project.create({
    data: { organizationId: elec.id, customerId: brightline.id, code: "PRJ-0002", name: "Brightline onboarding", summary: "Requirements are still being gathered.", status: "onboarding", projectType: "ecommerce", managerId: mira.id, searchText: "brightline onboarding prj-0002" },
  });
  await seedSrs(mira.id, priya.id, project.id, brightlineProject);
  await prisma.project.create({
    data: { organizationId: elec.id, customerId: northwind.id, code: "PRJ-0003", name: "Northwind archive sample", summary: "A delivered engagement kept for history.", status: "archived", statusBeforeArchive: "delivered", archivedAt: new Date(), managerId: mira.id, searchText: "northwind archive" },
  });
  await prisma.project.create({
    data: { organizationId: other.id, customerId: foreign.id, code: "PRJ-9000", name: "Northline private project", status: "active", searchText: "northline private" },
  });

  await syncSequences(prisma, elec.id);
  await syncSequences(prisma, other.id);

  console.info(`Seeded Elec Studio. Sign in as ada@elec.test / ${PASSWORD}`);
  console.info("Customer portal: priya@northwind.test");
  console.info("Other organization: other@northline.test");
}

async function seedActor(userId: string): Promise<Actor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { roles: { include: { role: { include: { permissions: true } } } } } });
  const permissions = [...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission)))];
  return { userId: user.id, organizationId: user.organizationId, customerId: user.customerId, kind: user.kind as Actor["kind"], email: user.email, name: user.name, permissions, sessionId: "seed", lastAuthenticatedAt: new Date(), timezone: "America/New_York", locale: "en-US", currency: "USD" };
}

async function seedSrs(managerId: string, clientId: string, projectId: string, draftProject: { id: string; code: string; name: string; projectType: string; organizationId: string } | null) {
  const pm = await seedActor(managerId);
  const client = await seedActor(clientId);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const doc = await createSrsDraft(prisma, pm, project);
  if (draftProject) await createSrsDraft(prisma, pm, draftProject);

  const answers: Array<[string, string, string]> = [
    ["purpose", "Give Northwind's account teams one place to see client reporting, approve deliverables and share documents, replacing three disconnected tools.", "client_input"],
    ["background", "Reporting is assembled by hand from spreadsheets each month. Clients email approvals, which are hard to trace during audits.", "client_input"],
    ["objectives", "Cut monthly reporting effort by half\nTraceable approvals for every deliverable\nOne secure portal for client documents", "client_input"],
    ["success_metrics", "Monthly report preparation drops from 6 days to 3. 100% of approvals recorded in the portal within the first quarter.", "client_input"],
    ["user_groups", "Account manager: prepares reports and requests approvals\nClient approver: reviews and approves deliverables\nAdministrator: manages users and access", "client_input"],
    ["proposed_solution", "A multi-tenant web application with a reporting module, an approval workflow and a document space, accessible to Northwind staff and their clients.", "elec_proposal"],
    ["platforms", "Web, desktop and tablet browsers", "client_input"],
    ["features", "Report builder: account managers assemble monthly reports from saved data sources\nApproval requests: send a deliverable to a client approver and track the decision\nDocument space: upload, version and share files with a client\nAudit trail: every approval and download is recorded", "client_input"],
    ["business_rules", "Only client approvers may approve deliverables\nApproved deliverables cannot be edited; changes create a new version", "client_input"],
    ["data_entities", "Client organisation\nReport\nDeliverable\nApproval decision\nDocument", "elec_proposal"],
    ["data_sensitivity", "Personal data", "client_input"],
    ["integrations", "Northwind data warehouse: nightly import of reporting figures (read-only)\nMicrosoft Entra ID: single sign-on for Northwind staff", "client_input"],
    ["access_control", "Clients see only their own organisation's reports and documents. Account managers see the clients assigned to them. Administrators manage access.", "client_input"],
    ["performance", "Up to 300 concurrent users at month end. Reports should open within 2 seconds.", "client_input"],
    ["in_scope", "Reporting module\nApproval workflow\nClient document space\nSingle sign-on for staff", "client_input"],
    ["out_of_scope", "Billing and invoicing integration\nNative mobile apps", "client_input"],
    ["future", "Scheduled report exports", "client_input"],
    ["assumptions", "Northwind provides read access to the data warehouse by October 1", "assumption"],
    ["deliverables", "Production web application\nAdministrator guide\nUser acceptance test report", "elec_proposal"],
    ["acceptance_approach", "Northwind runs user acceptance testing for two weeks against the acceptance criteria in this document.", "client_input"],
    ["open_questions", "Should client approvers be able to delegate approval while on leave?", "needs_clarification"],
  ];
  for (const [questionKey, value, origin] of answers) await saveAnswer(pm, doc.id, { questionKey, value, expectedVersion: 0, origin });
  await generateFromAnswers(pm, doc.id);

  const frs = await prisma.srsItem.findMany({ where: { documentId: doc.id, kind: "functional" }, orderBy: { seq: "asc" } });
  const criteria: Array<[string, string, string]> = [
    ["an account manager with a saved data source", "they build a monthly report", "the report shows the latest imported figures and can be saved as a draft"],
    ["a deliverable ready for review", "the account manager requests approval", "the client approver is notified and the request shows as pending"],
    ["a client user", "they upload a file to their document space", "the file is stored as a new version visible only to their organisation"],
  ];
  for (const [index, fr] of frs.entries()) {
    const ac = criteria[index];
    if (ac) await addCriterion(pm, fr.id, { given: ac[0], when: ac[1], then: ac[2] });
  }
  const perf = await createItem(pm, doc.id, { kind: "nonfunctional", title: "Report load time", origin: "client_input", priority: "must", data: { category: "performance", metric: "p95 page load for a report", target: "2 seconds at 300 concurrent users" } });
  await addCriterion(pm, perf!.id, { given: "300 concurrent users at month end", when: "a user opens a saved report", then: "it renders within 2 seconds for 95% of requests" });
  await createItem(pm, doc.id, { kind: "nonfunctional", title: "Tenant isolation", origin: "elec_proposal", priority: "must", data: { category: "security", metric: "Cross-tenant access attempts", target: "0 successful in penetration test" } });
  await createItem(pm, doc.id, { kind: "risk", title: "Data warehouse access arrives late", origin: "elec_proposal", visibility: "internal", description: "The reporting module could slip by up to two weeks.", data: { likelihood: "medium", impact: "high", mitigation: "Build against a sample extract first" } });

  let current = await prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id } });
  await updateSrsSettings(pm, doc.id, { clientAccess: true, version: current.version });
  current = await prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id } });
  await transitionSrs(pm, doc.id, "internal_review", { version: current.version });
  current = await prisma.srsDocument.findUniqueOrThrow({ where: { id: doc.id } });
  await transitionSrs(pm, doc.id, "client_review", { version: current.version, note: "First draft for Northwind review" });

  const approvals = frs[1];
  if (approvals) await addSrsComment(client, doc.id, { body: "Can an approver reject with a comment, and does the account manager see that comment?", targetType: "item", targetKey: approvals.key, kind: "clarification" });
  await addSrsComment(pm, doc.id, { body: "Delegation question is open with Northwind legal — do not commit to it yet.", visibility: "internal" });
}

async function backfillSrs(orgId: string) {
  const missing = await prisma.project.findMany({ where: { organizationId: orgId, archivedAt: null, srsDocuments: { none: {} } }, orderBy: { code: "asc" } });
  if (!missing.length) return;
  const manager = await prisma.user.findFirst({ where: { organizationId: orgId, email: "mira@elec.test", status: "active" } });
  const client = await prisma.user.findFirst({ where: { organizationId: orgId, email: "priya@northwind.test", status: "active" } });
  if (!manager) return;
  const pm = await seedActor(manager.id);
  for (const project of missing) {
    if (project.code === "PRJ-0001" && client) {
      if (project.projectType === "custom") await prisma.project.update({ where: { id: project.id }, data: { projectType: "saas" } });
      await seedSrs(manager.id, client.id, project.id, null);
    } else {
      await createSrsDraft(prisma, pm, project);
    }
  }
  console.info(`Added SRS documents to ${missing.length} existing project(s).`);
}

main().finally(async () => prisma.$disconnect());
