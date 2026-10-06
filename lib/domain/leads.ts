import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { can, requirePermission } from "@/lib/actor";
import { createOpportunity, runLeadAutomation, scoreAndStore } from "@/lib/domain/crm";
import { createCustomer, addContact } from "@/lib/domain/customers";
import { LEAD_TRANSITIONS, canTransition } from "@/lib/domain/workflow";
import { assertEnabledLookup, nextCode, rememberIdempotency, replayOrClaim, writeActivity, writeAudit } from "@/lib/domain/support";
import { conflict, validationError } from "@/lib/errors";
import { cleanText, searchBlob } from "@/lib/text";

export { listLeads, getLead, assignLeads, findLeadDuplicates, mergeLeads, dataQuality, slaBreaches, previewLeadImport, commitLeadImport, createCrmActivity, completeCrmActivity, listOpportunities, getOpportunity, archiveOpportunity, transitionOpportunity, forecast, createCampaign, listCampaigns, routeLead, saveRoutingRule, listRoutingRules, defineCustomField, listAssignableEmployees, listCrmTeams, leadWorkload, listCampaignOptions } from "@/lib/domain/crm";

export async function createLead(actor: Actor, input: { name: string; company?: string; email?: string; phone?: string; source?: string; industry?: string; location?: string; priority?: string; estimatedValueCents?: number; campaignId?: string | null; notes?: string; idempotencyKey?: string | null }) {
  requirePermission(actor, "leads.create");
  const name = cleanText(input.name, 160);
  if (name.length < 2) throw validationError("Enter the lead name.", { name: "Enter the lead name." });
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !email.includes("@")) throw validationError("Enter a valid email.", { email: "Enter a valid email." });
  if (email) {
    const duplicate = await prisma.contact.findFirst({ where: { organizationId: actor.organizationId, email, archivedAt: null } });
    if (duplicate) throw conflict("This email already belongs to a contact. Open that customer instead of creating a duplicate lead.");
    const existingLead = await prisma.lead.findFirst({ where: { organizationId: actor.organizationId, email, mergedIntoId: null, archivedAt: null } });
    if (existingLead) throw conflict(`This email already belongs to lead ${existingLead.code}.`);
  }
  if (input.source) await assertEnabledLookup(prisma, actor.organizationId, "lead_source", input.source);
  if (input.campaignId) {
    const campaign = await prisma.campaign.findFirst({ where: { id: input.campaignId, organizationId: actor.organizationId, archivedAt: null }, select: { id: true } });
    if (!campaign) throw validationError("That campaign was not found.", { campaignId: "Choose an active campaign." });
  }
  if (input.priority && !["low", "medium", "high", "critical"].includes(input.priority)) throw validationError("Choose a priority.");
  const created = await prisma.$transaction(async (tx) => {
    const replay = await replayOrClaim(tx, actor, input.idempotencyKey, "lead");
    if (replay) return { id: replay, replayed: true };
    const code = await nextCode(tx, actor.organizationId, "lead", "LED");
    const company = cleanText(input.company ?? "", 160);
    const lead = await tx.lead.create({
      data: {
        organizationId: actor.organizationId,
        code,
        name,
        company,
        email,
        phone: input.phone?.trim() || null,
        domain: email?.includes("@") ? email.split("@")[1] : null,
        source: input.source,
        industry: input.industry || null,
        location: cleanText(input.location ?? "", 120) || null,
        priority: input.priority || "medium",
        estimatedValueCents: input.estimatedValueCents ?? null,
        currency: actor.currency,
        campaignId: input.campaignId || null,
        ownerId: actor.userId,
        salesOwnerId: actor.userId,
        ownershipStatus: "assigned",
        assignedAt: new Date(),
        assignedById: actor.userId,
        assignmentReason: "Created the lead",
        notes: cleanText(input.notes ?? "", 4000),
        searchText: searchBlob([name, company, email, input.phone, code, input.location]),
      },
    });
    await tx.leadAssignment.create({
      data: { organizationId: actor.organizationId, leadId: lead.id, toUserId: actor.userId, assignmentType: "assign", reason: "Created the lead", actorId: actor.userId, actorName: actor.name },
    });
    await writeAudit(tx, actor, { action: "lead.create", entityType: "lead", entityId: lead.id, after: { name, email, ownerId: actor.userId } });
    await writeActivity(tx, actor, { type: "lead.create", summary: `Opened lead ${name}`, entityType: "lead", entityId: lead.id });
    await rememberIdempotency(tx, actor, input.idempotencyKey, "lead", lead.id);
    return { id: lead.id, replayed: false };
  });
  if (!created.replayed) {
    await scoreAndStore(actor.organizationId, created.id);
    await runLeadAutomation(actor, created.id, "lead.created");
  }
  return created;
}

export async function transitionLead(actor: Actor, id: string, status: string, reason = "") {
  requirePermission(actor, "leads.edit");
  const lead = await prisma.lead.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!lead) throw validationError("Lead not found.");
  if (lead.status === "converted") throw conflict("Converted leads stay linked to their customer.");
  if (lead.archivedAt && status !== "new") throw conflict("Restore the lead before changing its stage.");
  if (!canTransition(LEAD_TRANSITIONS, lead.status, status)) throw validationError(`Cannot move this lead from ${lead.status} to ${status}.`);
  if (status === "lost" && cleanText(reason, 500).length < 3) throw validationError("Give a reason when marking a lead lost.", { reason: "Required." });
  await prisma.lead.update({
    where: { id },
    data: { status, lostReason: status === "lost" ? cleanText(reason, 500) : lead.lostReason, nurtureState: status === "nurturing" ? "active" : status === "dormant" ? "paused" : lead.nurtureState, archivedAt: status === "archived" ? new Date() : null },
  });
  await writeAudit(prisma, actor, { action: "lead.status", entityType: "lead", entityId: id, before: { status: lead.status }, after: { status, reason } });
  await writeActivity(prisma, actor, { type: "lead.status", summary: `${lead.name} is ${status}`, entityType: "lead", entityId: id });
}

export async function convertLead(actor: Actor, id: string, idempotencyKey?: string | null, existingCustomerId?: string | null) {
  requirePermission(actor, "leads.convert");
  const lead = await prisma.lead.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!lead) throw validationError("Lead not found.");
  if (lead.status === "converted" && lead.customerId) return { id: lead.customerId, opportunityId: null, replayed: true };
  if (lead.status !== "qualified") throw validationError("Qualify the lead before converting it.");
  let customerId = existingCustomerId || null;
  if (!customerId && lead.email) {
    const existingContact = await prisma.contact.findFirst({ where: { organizationId: actor.organizationId, email: lead.email, archivedAt: null }, include: { customer: { select: { name: true, code: true } } } });
    if (existingContact) throw validationError(`This email already belongs to ${existingContact.customer.name} (${existingContact.customer.code}). Link that customer instead of creating another company.`);
  }
  if (customerId) {
    const existing = await prisma.customer.findFirst({ where: { id: customerId, organizationId: actor.organizationId } });
    if (!existing) throw validationError("That customer was not found.");
  } else {
    const customer = await createCustomer(actor, {
      name: lead.company || lead.name,
      kind: lead.company ? "company" : "individual",
      status: "onboarding",
      source: lead.source,
      accountManagerId: lead.accountManagerId ?? lead.ownerId,
      notes: lead.notes,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:customer` : null,
    });
    customerId = customer.id;
    if (lead.email) {
      await addContact(actor, customerId, { name: lead.name, email: lead.email, phone: lead.phone ?? undefined, isPrimary: true, idempotencyKey: idempotencyKey ? `${idempotencyKey}:contact` : null });
    }
  }
  const opportunity = can(actor, "opportunities.edit")
    ? await createOpportunity(actor, { customerId, name: lead.company || lead.name, leadId: lead.id, valueCents: lead.estimatedValueCents ?? 0, source: lead.source ?? undefined, campaignId: lead.campaignId })
    : null;
  await prisma.lead.update({ where: { id }, data: { status: "converted", customerId, convertedAt: new Date(), lastActivityAt: new Date() } });
  await writeAudit(prisma, actor, { action: "lead.convert", entityType: "lead", entityId: id, after: { customerId, opportunityId: opportunity?.id ?? null } });
  await writeActivity(prisma, actor, { type: "lead.converted", summary: `Converted ${lead.name} into a customer and opportunity`, customerId, entityType: "lead", entityId: id, visibility: "internal" });
  return { id: customerId, opportunityId: opportunity?.id ?? null, replayed: false };
}

export async function previewConversion(actor: Actor, id: string) {
  requirePermission(actor, "leads.convert");
  const lead = await prisma.lead.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!lead) throw validationError("Lead not found.");
  const email = lead.email?.trim().toLowerCase() || null;
  const existingContact = email
    ? await prisma.contact.findFirst({ where: { organizationId: actor.organizationId, email, archivedAt: null }, include: { customer: { select: { id: true, name: true, code: true } } } })
    : null;
  const recentCustomers = await prisma.customer.findMany({
    where: { organizationId: actor.organizationId, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 12,
    select: { id: true, name: true, code: true },
  });
  return {
    ready: lead.status === "qualified",
    customerName: lead.company || lead.name,
    kind: lead.company ? "company" : "individual",
    contactName: lead.name,
    contactEmail: email,
    opportunityName: lead.company || lead.name,
    valueCents: lead.estimatedValueCents ?? 0,
    currency: lead.currency,
    existingContact: existingContact ? { customerId: existingContact.customer.id, customerName: existingContact.customer.name, customerCode: existingContact.customer.code } : null,
    recentCustomers,
  };
}

export async function addReminder(actor: Actor, input: { note: string; dueAt: string; leadId?: string; customerId?: string; projectId?: string; assigneeId?: string }) {
  requirePermission(actor, "leads.edit");
  const due = new Date(input.dueAt);
  if (Number.isNaN(due.getTime())) throw validationError("Choose a reminder time.", { dueAt: "Choose a valid time." });
  const reminder = await prisma.reminder.create({
    data: {
      organizationId: actor.organizationId,
      assigneeId: input.assigneeId ?? actor.userId,
      createdById: actor.userId,
      leadId: input.leadId,
      customerId: input.customerId,
      projectId: input.projectId,
      dueAt: due,
      note: cleanText(input.note, 1000),
    },
  });
  if (input.leadId) await prisma.lead.updateMany({ where: { id: input.leadId, organizationId: actor.organizationId }, data: { nextFollowUpAt: due } });
  return reminder;
}

export async function qualifyLead(actor: Actor, id: string, qualification: Record<string, string>) {
  requirePermission(actor, "leads.edit");
  const lead = await prisma.lead.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!lead) throw validationError("Lead not found.");
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(qualification)) {
    if (!/^[a-z][a-z0-9_]{0,32}$/.test(key)) continue;
    clean[key] = cleanText(value, 500);
  }
  await prisma.lead.update({ where: { id }, data: { qualification: JSON.stringify(clean), lastActivityAt: new Date() } });
  await writeAudit(prisma, actor, { action: "lead.qualify", entityType: "lead", entityId: id, before: { qualification: lead.qualification }, after: clean });
}
