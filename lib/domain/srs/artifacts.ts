import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { requirePermission } from "@/lib/actor";
import { writeAudit } from "@/lib/domain/support";
import { forbidden, notFound, validationError } from "@/lib/errors";
import { log } from "@/lib/log";
import { getObject, putObject } from "@/lib/storage";
import { loadSrs, versionLabel } from "@/lib/domain/srs/core";
import { buildDocModel, loadDocInputs, type DocModel, type DocSigner } from "@/lib/domain/srs/model";

const MEDIA = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } as const;
export type SrsFormat = keyof typeof MEDIA;

export function srsFileName(projectCode: string, label: string, format: SrsFormat, suffix = "") {
  const safe = (value: string) => value.replace(/\.{2,}/g, "").replace(/[^A-Za-z0-9.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `ELEC-NOVA-${safe(projectCode)}-SRS-v${safe(label)}${suffix ? `-${safe(suffix)}` : ""}.${format}`;
}

export async function renderModel(model: DocModel, format: SrsFormat, watermark?: string) {
  if (format === "pdf") {
    const { renderPdf } = await import("@/lib/domain/srs/pdf");
    return renderPdf(model, watermark);
  }
  const { renderDocx } = await import("@/lib/domain/srs/docx");
  return renderDocx(model, watermark);
}

async function signersFor(versionId: string): Promise<DocSigner[]> {
  const signatures = await prisma.srsSignature.findMany({ where: { versionId }, orderBy: { createdAt: "asc" } });
  return signatures.map((s) => ({ side: s.side, name: s.signerName, role: s.signerRole, decision: s.decision, date: s.createdAt.toISOString().replace("T", " ").slice(0, 16) + " UTC", method: s.method, hash: s.signatureHash.slice(0, 16) }));
}

async function versionModel(version: { id: string; snapshot: string; status: string }) {
  const model = JSON.parse(version.snapshot) as DocModel;
  model.approval.signatures = await signersFor(version.id);
  if (version.status === "approved" || version.status === "superseded") {
    model.meta.status = version.status;
    model.meta.statusLabel = version.status === "approved" ? "Approved" : "Superseded";
  }
  return model;
}

export async function storeApprovedArtifacts(versionId: string, createdByName: string) {
  const version = await prisma.srsVersion.findUniqueOrThrow({ where: { id: versionId }, include: { document: { include: { project: { select: { code: true, organizationId: true } } } } } });
  if (version.status !== "approved") return;
  const model = await versionModel(version);
  for (const format of ["pdf", "docx"] as const) {
    const exists = await prisma.srsArtifact.findUnique({ where: { versionId_format: { versionId, format } } });
    if (exists) continue;
    const bytes = await renderModel(model, format);
    const storageKey = `${version.document.project.organizationId}/srs/${randomBytes(16).toString("hex")}`;
    await putObject(storageKey, bytes, MEDIA[format]);
    try {
      await prisma.srsArtifact.create({
        data: { documentId: version.documentId, versionId, format, fileName: srsFileName(version.document.project.code, version.label, format), storageKey, sha256: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.byteLength, createdByName },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
}

export async function downloadSrs(actor: Actor, documentId: string, input: { ref: string; format: string }) {
  if (input.format !== "pdf" && input.format !== "docx") throw validationError("Choose PDF or DOCX.");
  const format = input.format as SrsFormat;
  const { doc, project } = await loadSrs(prisma, actor, documentId);
  let bytes: Buffer;
  let fileName: string;
  let label: string;
  if (input.ref === "latest") {
    if (actor.kind === "customer") throw notFound("Version not found.");
    requirePermission(actor, "srs.download_draft");
    label = `${versionLabel(doc)}-draft`;
    const model = buildDocModel(await loadDocInputs(prisma, documentId));
    bytes = await renderModel(model, format, doc.status === "approved" ? undefined : "DRAFT");
    fileName = srsFileName(project.code, versionLabel(doc), format, "DRAFT");
  } else {
    const versionId = input.ref === "approved" ? doc.approvedVersionId : input.ref;
    if (!versionId) throw notFound("There is no approved version yet.");
    const version = await prisma.srsVersion.findFirst({ where: { id: versionId, documentId } });
    if (!version || (actor.kind === "customer" && !version.clientVisible)) throw notFound("Version not found.");
    const approvedLike = version.status === "approved" || version.status === "superseded";
    if (approvedLike) requirePermission(actor, "srs.download_approved");
    else if (actor.kind === "employee") requirePermission(actor, "srs.download_draft");
    label = version.label;
    const current = version.status === "approved" && doc.approvedVersionId === version.id;
    if (current) {
      let artifact = await prisma.srsArtifact.findUnique({ where: { versionId_format: { versionId: version.id, format } } });
      if (!artifact) {
        await storeApprovedArtifacts(version.id, "System");
        artifact = await prisma.srsArtifact.findUnique({ where: { versionId_format: { versionId: version.id, format } } });
      }
      if (!artifact) throw notFound("The approved file is not available yet. Try again shortly.");
      bytes = await getObject(artifact.storageKey);
      if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
        log("error", "srs.artifact_tampered", { artifactId: artifact.id });
        throw forbidden("The stored approved file failed its integrity check. An administrator has been alerted.");
      }
      fileName = artifact.fileName;
    } else {
      const mark = version.status === "superseded" ? "SUPERSEDED" : version.status === "in_approval" ? "PENDING APPROVAL" : version.status === "approved" ? undefined : version.kind === "review" ? "REVIEW COPY" : "NOT APPROVED";
      bytes = await renderModel(await versionModel(version), format, mark);
      fileName = srsFileName(project.code, version.label, format, mark ?? "");
    }
  }
  await writeAudit(prisma, actor, { action: "srs.download", entityType: "srs", entityId: documentId, metadata: { ref: input.ref, label, format, bytes: bytes.byteLength } });
  return { bytes, fileName, mediaType: MEDIA[format] };
}
