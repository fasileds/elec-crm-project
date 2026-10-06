import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { requirePermission } from "@/lib/actor";
import { loadProject } from "@/lib/domain/access";
import { notifyUser, scheduleOutbox, writeActivity, writeAudit } from "@/lib/domain/support";
import { detectUpload } from "@/lib/files/sniff";
import { conflict, forbidden, notFound, validationError } from "@/lib/errors";
import { safeFileName } from "@/lib/text";

const ROOT = path.join(process.cwd(), "storage");

export async function saveDocument(
  actor: Actor,
  input: { projectId?: string; customerId?: string; category?: string; visibility?: "internal" | "customer"; fileName: string; bytes: Uint8Array; rootDocumentId?: string },
) {
  requirePermission(actor, "documents.upload");
  const visibility = actor.kind === "customer" ? "customer" : input.visibility === "customer" ? "customer" : "internal";
  if (visibility === "customer") requirePermission(actor, "documents.share");
  let customerId = input.customerId ?? null;
  const projectId = input.projectId ?? null;
  if (projectId) {
    const project = await loadProject(prisma, actor, projectId);
    if (project.archivedAt) throw conflict("Archived projects cannot receive new files.");
    customerId = project.customerId;
  } else if (customerId) {
    const { loadCustomer } = await import("@/lib/domain/access");
    const customer = await loadCustomer(prisma, actor, customerId);
    if (customer.archivedAt) throw conflict("Archived customers cannot receive new files.");
  } else throw validationError("Choose a project or customer for this file.");
  if (input.category) {
    const { assertEnabledLookup } = await import("@/lib/domain/support");
    await assertEnabledLookup(prisma, actor.organizationId, "document_category", input.category);
  }
  const fileName = safeFileName(input.fileName);
  const sniffed = detectUpload(fileName, input.bytes);
  if (!sniffed.ok) throw validationError(sniffed.message);
  const storageKey = path.posix.join(actor.organizationId, randomBytes(16).toString("hex"));
  const absolute = path.resolve(ROOT, storageKey);
  if (!absolute.startsWith(path.resolve(ROOT))) throw forbidden("Invalid storage path.");
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, input.bytes);
  const previous = input.rootDocumentId
    ? await prisma.document.findFirst({ where: { id: input.rootDocumentId, organizationId: actor.organizationId } })
    : null;
  const document = await prisma.document.create({
    data: {
      organizationId: actor.organizationId,
      customerId,
      projectId,
      category: input.category ?? "general",
      visibility,
      fileName,
      storageKey,
      byteSize: input.bytes.byteLength,
      mediaType: sniffed.mediaType,
      checksum: createHash("sha256").update(input.bytes).digest("hex"),
      version: previous ? previous.version + 1 : 1,
      rootDocumentId: previous?.rootDocumentId ?? previous?.id,
      uploadedById: actor.userId,
      uploaderName: actor.name,
    },
  });
  await writeAudit(prisma, actor, { action: "document.upload", entityType: "document", entityId: document.id, after: { fileName, visibility, byteSize: document.byteSize } });
  await writeActivity(prisma, actor, { type: "document.uploaded", summary: `Uploaded ${fileName}`, customerId, projectId, visibility, entityType: "document", entityId: document.id });
  if (visibility === "customer" && customerId) {
    const customers = await prisma.user.findMany({ where: { customerId, status: "active", kind: "customer" } });
    for (const user of customers) {
      if (user.id === actor.userId) continue;
      await notifyUser(prisma, {
        organizationId: actor.organizationId,
        userId: user.id,
        type: "document",
        title: `Document shared: ${fileName}`,
        body: `${actor.name} shared a file.`,
        href: `/portal/documents`,
        dedupeKey: `doc:${document.id}:${user.id}`,
        email: { to: user.email, template: "document", payload: { actor: actor.name, file: fileName, url: `/portal/documents` } },
      });
    }
    scheduleOutbox();
  }
  return { id: document.id };
}

export async function readDocument(actor: Actor, id: string) {
  const document = await prisma.document.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!document || document.archivedAt) throw notFound("File not found.");
  if (actor.kind === "customer" && (document.visibility !== "customer" || document.customerId !== actor.customerId)) {
    throw notFound("File not found.");
  }
  if (document.projectId) await loadProject(prisma, actor, document.projectId);
  else requirePermission(actor, "documents.view");
  const absolute = path.resolve(ROOT, document.storageKey);
  if (!absolute.startsWith(path.resolve(ROOT))) throw forbidden("Invalid storage path.");
  const bytes = await readFile(absolute);
  return { fileName: document.fileName, mediaType: document.mediaType, bytes };
}

export async function listDocuments(actor: Actor, query: { projectId?: string; customerId?: string }) {
  requirePermission(actor, "documents.view");
  return prisma.document.findMany({
    where: {
      organizationId: actor.organizationId,
      archivedAt: null,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(actor.kind === "customer" ? { customerId: actor.customerId ?? "__none__", visibility: "customer" } : query.customerId ? { customerId: query.customerId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, fileName: true, category: true, visibility: true, byteSize: true, version: true, createdAt: true, uploaderName: true, projectId: true, customerId: true },
  });
}
