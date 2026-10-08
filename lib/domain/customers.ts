import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { requireEmployee, requirePermission } from "@/lib/actor";
import { customerListScope, loadCustomer } from "@/lib/domain/access";
import {
  assertEnabledLookup,
  nextCode,
  rememberIdempotency,
  replayOrClaim,
  writeActivity,
  writeAudit,
} from "@/lib/domain/support";
import type { Prisma } from "@prisma/client";
import { conflict, validationError } from "@/lib/errors";
import { cleanText, searchBlob, textMatch } from "@/lib/text";

export type CustomerInput = {
  name: string;
  kind?: "company" | "individual";
  status?: string;
  industry?: string | null;
  source?: string | null;
  category?: string | null;
  website?: string | null;
  accountManagerId?: string | null;
  notes?: string;
  customFields?: Record<string, string>;
  tags?: string[];
  idempotencyKey?: string | null;
};

const PAGE = 25;

function customerSearch(input: { name: string; code?: string; industry?: string | null; website?: string | null; notes?: string }) {
  return searchBlob([input.name, input.code, input.industry, input.website, input.notes]);
}

export async function listCustomers(actor: Actor, query: { page?: number; q?: string; status?: string; tag?: string; sort?: string }) {
  requireEmployee(actor);
  const page = Math.max(1, query.page ?? 1);
  const q = query.q?.trim().toLowerCase();
  const sort = query.sort === "name" ? "name" : "updatedAt";
  const where = {
    organizationId: actor.organizationId,
    ...customerListScope(actor),
    ...(query.status ? { status: query.status } : {}),
    ...(query.tag ? { tags: { some: { tag: { name: query.tag } } } } : {}),
    ...(q ? { searchText: textMatch(q) } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { [sort]: sort === "name" ? "asc" : "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { accountManager: { select: { id: true, name: true, status: true } }, tags: { include: { tag: true } }, _count: { select: { projects: true, contacts: true } } },
    }),
  ]);
  return {
    items: rows.map(presentCustomer),
    page,
    pageSize: PAGE,
    total,
  };
}

export async function getCustomer(actor: Actor, id: string) {
  const customer = await loadCustomer(prisma, actor, id);
  const [manager, contacts, addresses, projects, activities, tags] = await Promise.all([
    customer.accountManagerId ? prisma.user.findUnique({ where: { id: customer.accountManagerId }, select: { id: true, name: true, status: true } }) : Promise.resolve(null),
    prisma.contact.findMany({ where: { customerId: id, archivedAt: null }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }] }),
    prisma.address.findMany({ where: { customerId: id } }),
    prisma.project.findMany({
      where: { customerId: id, ...(actor.kind === "customer" ? {} : {}) },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, code: true, name: true, status: true, healthStatus: true, healthScore: true, dueOn: true },
    }),
    prisma.activity.findMany({
      where: { customerId: id, ...(actor.kind === "customer" ? { visibility: "customer" } : {}) },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    prisma.customerTag.findMany({ where: { customerId: id }, include: { tag: true } }),
  ]);
  return { ...presentCustomer({ ...customer, tags, accountManager: manager, _count: { projects: projects.length, contacts: contacts.length } }), contacts, addresses, projects, activities };
}

export async function createCustomer(actor: Actor, input: CustomerInput) {
  requirePermission(actor, "customers.create");
  const name = cleanText(input.name, 160);
  if (name.length < 2) throw validationError("Enter the customer name.", { name: "Enter at least 2 characters." });
  return prisma.$transaction(async (tx) => {
    const replay = await replayOrClaim(tx, actor, input.idempotencyKey, "customer");
    if (replay) return { id: replay, replayed: true };
    await assertEnabledLookup(tx, actor.organizationId, "customer_status", input.status ?? "active");
    if (input.industry) await assertEnabledLookup(tx, actor.organizationId, "industry", input.industry);
    if (input.source) await assertEnabledLookup(tx, actor.organizationId, "lead_source", input.source);
    if (input.category) await assertEnabledLookup(tx, actor.organizationId, "customer_category", input.category);
    const code = await nextCode(tx, actor.organizationId, "customer", "CUS");
    const customer = await tx.customer.create({
      data: {
        organizationId: actor.organizationId,
        code,
        name,
        kind: input.kind === "individual" ? "individual" : "company",
        status: input.status ?? "active",
        industry: input.industry,
        source: input.source,
        category: input.category,
        website: input.website ? cleanText(input.website, 200) : null,
        accountManagerId: input.accountManagerId,
        notes: cleanText(input.notes ?? "", 4000),
        customFields: JSON.stringify(input.customFields ?? {}),
        searchText: customerSearch({ name, code, industry: input.industry, website: input.website, notes: input.notes }),
      },
    });
    if (input.tags?.length) await attachTags(tx, actor.organizationId, customer.id, input.tags);
    await writeAudit(tx, actor, { action: "customer.create", entityType: "customer", entityId: customer.id, after: { name, code } });
    await writeActivity(tx, actor, { type: "customer.created", summary: `Created customer ${name}`, customerId: customer.id, entityType: "customer", entityId: customer.id });
    await rememberIdempotency(tx, actor, input.idempotencyKey, "customer", customer.id);
    return { id: customer.id, replayed: false };
  });
}

export async function updateCustomer(actor: Actor, id: string, input: CustomerInput & { version: number }) {
  requirePermission(actor, "customers.edit");
  const current = await loadCustomer(prisma, actor, id);
  if (current.archivedAt) throw conflict("Archived customers are read-only until they are restored.");
  const name = cleanText(input.name, 160);
  const result = await prisma.customer.updateMany({
    where: { id, version: input.version, organizationId: actor.organizationId },
    data: {
      name,
      kind: input.kind === "individual" ? "individual" : "company",
      status: input.status ?? current.status,
      industry: input.industry,
      source: input.source,
      category: input.category,
      website: input.website,
      accountManagerId: input.accountManagerId,
      notes: cleanText(input.notes ?? "", 4000),
      customFields: JSON.stringify(input.customFields ?? {}),
      searchText: customerSearch({ name, code: current.code, industry: input.industry, website: input.website, notes: input.notes }),
      version: { increment: 1 },
    },
  });
  if (result.count !== 1) throw conflict("Someone else updated this customer. Reload and try again.");
  await writeAudit(prisma, actor, { action: "customer.update", entityType: "customer", entityId: id, before: { name: current.name, status: current.status }, after: { name, status: input.status } });
  return { id };
}

export async function archiveCustomer(actor: Actor, id: string, restore = false) {
  requirePermission(actor, "customers.archive");
  const current = await loadCustomer(prisma, actor, id);
  await prisma.customer.update({
    where: { id: current.id },
    data: restore
      ? { status: current.statusBeforeArchive || "active", statusBeforeArchive: null, archivedAt: null }
      : { statusBeforeArchive: current.status, status: "archived", archivedAt: new Date() },
  });
  await writeAudit(prisma, actor, { action: restore ? "customer.restore" : "customer.archive", entityType: "customer", entityId: id });
  await writeActivity(prisma, actor, {
    type: restore ? "customer.restored" : "customer.archived",
    summary: restore ? `Restored ${current.name}` : `Archived ${current.name}`,
    customerId: id,
  });
}

export async function addContact(
  actor: Actor,
  customerId: string,
  input: { name: string; email?: string; phone?: string; title?: string; isPrimary?: boolean; idempotencyKey?: string | null },
) {
  requirePermission(actor, "customers.edit");
  const customer = await loadCustomer(prisma, actor, customerId);
  if (customer.archivedAt) throw conflict("Archived customers cannot be changed.");
  const email = input.email?.trim().toLowerCase() || null;
  if (email) {
    const duplicate = await prisma.contact.findFirst({ where: { organizationId: actor.organizationId, email, archivedAt: null } });
    if (duplicate) throw conflict("A contact with this email already exists. Merge the records instead of creating a duplicate.");
  }
  return prisma.$transaction(async (tx) => {
    const replay = await replayOrClaim(tx, actor, input.idempotencyKey, "contact");
    if (replay) return { id: replay, replayed: true };
    if (input.isPrimary) await tx.contact.updateMany({ where: { customerId }, data: { isPrimary: false } });
    const contact = await tx.contact.create({
      data: {
        organizationId: actor.organizationId,
        customerId,
        name: cleanText(input.name, 160),
        email,
        phone: input.phone?.trim() || null,
        title: input.title?.trim() || null,
        isPrimary: Boolean(input.isPrimary),
        searchText: searchBlob([input.name, email, input.phone, input.title, customer.name]),
      },
    });
    await tx.customer.update({
      where: { id: customerId },
      data: { searchText: searchBlob([customer.searchText, input.name, email, input.phone]) },
    });
    await writeAudit(tx, actor, { action: "contact.create", entityType: "contact", entityId: contact.id, after: { name: contact.name, email } });
    await rememberIdempotency(tx, actor, input.idempotencyKey, "contact", contact.id);
    return { id: contact.id, replayed: false };
  });
}

export async function findDuplicates(actor: Actor, input: { name?: string; email?: string; phone?: string }) {
  requirePermission(actor, "customers.view");
  const email = input.email?.trim().toLowerCase();
  const phone = input.phone?.replace(/\D/g, "");
  const name = input.name?.trim().toLowerCase();
  const contacts = await prisma.contact.findMany({
    where: {
      organizationId: actor.organizationId,
      archivedAt: null,
      OR: [
        ...(email ? [{ email }] : []),
        ...(phone ? [{ phone: { contains: phone.slice(-7) } }] : []),
        ...(name && name.length > 2 ? [{ searchText: textMatch(name) }] : []),
      ],
    },
    take: 8,
    include: { customer: { select: { id: true, name: true, code: true, status: true } } },
  });
  return contacts.map((contact) => ({
    contactId: contact.id,
    name: contact.name,
    email: contact.email,
    customerId: contact.customer.id,
    customerName: contact.customer.name,
    customerCode: contact.customer.code,
    exactEmail: Boolean(email && contact.email === email),
  }));
}

export async function mergeCustomers(actor: Actor, sourceId: string, targetId: string) {
  requirePermission(actor, "customers.merge");
  if (sourceId === targetId) throw validationError("Choose two different customers.");
  const source = await loadCustomer(prisma, actor, sourceId);
  const target = await loadCustomer(prisma, actor, targetId);
  if (source.mergedIntoId || target.mergedIntoId) throw conflict("One of these customers has already been merged.");
  await prisma.$transaction(async (tx) => {
    const moved = {
      contacts: (await tx.contact.findMany({ where: { customerId: sourceId }, select: { id: true } })).map((row) => row.id),
      projects: (await tx.project.findMany({ where: { customerId: sourceId }, select: { id: true } })).map((row) => row.id),
    };
    await tx.contact.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
    await tx.project.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
    await tx.address.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
    await tx.activity.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
    await tx.document.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
    await tx.comment.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
    await tx.lead.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
    await tx.user.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
    await tx.customer.update({
      where: { id: sourceId },
      data: { statusBeforeArchive: source.status, status: "archived", archivedAt: new Date(), mergedIntoId: targetId },
    });
    await writeAudit(tx, actor, {
      action: "customer.merge",
      entityType: "customer",
      entityId: targetId,
      metadata: { sourceId, ...moved },
    });
    await writeActivity(tx, actor, {
      type: "customer.merged",
      summary: `Merged ${source.name} into ${target.name}`,
      customerId: targetId,
      visibility: "internal",
    });
  });
}

async function attachTags(tx: Prisma.TransactionClient, organizationId: string, customerId: string, tags: string[]) {
  for (const raw of tags) {
    const name = cleanText(raw, 40);
    if (!name) continue;
    const tag = await tx.tag.upsert({
      where: { organizationId_name: { organizationId, name } },
      create: { organizationId, name },
      update: {},
    });
    await tx.customerTag.upsert({
      where: { customerId_tagId: { customerId, tagId: tag.id } },
      create: { customerId, tagId: tag.id },
      update: {},
    });
  }
}

function presentCustomer(customer: {
  id: string;
  code: string;
  name: string;
  kind: string;
  status: string;
  industry: string | null;
  source: string | null;
  category: string | null;
  website: string | null;
  notes: string;
  archivedAt: Date | null;
  updatedAt: Date;
  version: number;
  accountManager: { id: string; name: string; status: string } | null;
  tags: Array<{ tag: { name: string } }>;
  _count: { projects: number; contacts: number };
}) {
  return {
    id: customer.id,
    code: customer.code,
    name: customer.name,
    kind: customer.kind,
    status: customer.status,
    industry: customer.industry,
    source: customer.source,
    category: customer.category,
    website: customer.website,
    notes: customer.notes,
    archivedAt: customer.archivedAt,
    updatedAt: customer.updatedAt,
    version: customer.version,
    accountManager: customer.accountManager,
    tags: customer.tags.map((entry) => entry.tag.name),
    projectCount: customer._count.projects,
    contactCount: customer._count.contacts,
  };
}

export async function saveCustomerView(actor: Actor, name: string, query: Record<string, string>) {
  requireEmployee(actor);
  return prisma.savedView.create({
    data: {
      organizationId: actor.organizationId,
      userId: actor.userId,
      entityType: "customer",
      name: cleanText(name, 80),
      query: JSON.stringify(query),
    },
    select: { id: true, name: true, query: true },
  });
}

