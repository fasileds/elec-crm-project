import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { requirePermission } from "@/lib/actor";
import type { Db } from "@/lib/domain/support";
import { writeAudit } from "@/lib/domain/support";
import { conflict, notFound, validationError } from "@/lib/errors";
import { KINDS, PROJECT_TYPES, defaultTemplateConfig, type TemplateConfig } from "@/lib/domain/srs/catalog";

const key = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "Keys use lowercase letters, numbers and underscores.");

const configSchema = z.object({
  sections: z
    .array(
      z.object({
        key,
        title: z.string().trim().min(2).max(120),
        group: z.string().trim().min(2).max(60),
        required: z.boolean(),
        guidance: z.string().max(500).optional(),
        kinds: z.array(z.string()).optional(),
        nfr: z.string().optional(),
        prefill: z.enum(["summary", "objectives", "scope", "opportunity", "milestones", "team", "change_management", "signatures", "testing"]).optional(),
      }),
    )
    .min(3)
    .max(80),
  steps: z
    .array(
      z.object({
        key,
        title: z.string().trim().min(2).max(60),
        intro: z.string().max(300),
        questions: z
          .array(
            z.object({
              key,
              label: z.string().trim().min(3).max(300),
              help: z.string().max(400).optional(),
              type: z.enum(["text", "longtext", "list", "choice"]),
              options: z.array(z.string().max(120)).max(20).optional(),
              required: z.boolean(),
              section: key,
              generates: z.string().optional(),
            }),
          )
          .max(30),
      }),
    )
    .min(1)
    .max(40),
  requiredKinds: z.array(z.string()).max(30),
  approval: z.object({
    clientSigners: z.number().int().min(0).max(10),
    companySigners: z.number().int().min(1).max(10),
    statement: z.string().trim().min(20).max(1000),
  }),
  styling: z.object({
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #0b5cab."),
    footer: z.string().max(160),
    confidentiality: z.string().max(60),
  }),
});

export function parseTemplateConfig(raw: string | unknown): TemplateConfig {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw validationError(`Template is invalid at ${issue.path.join(".") || "root"}: ${issue.message}`);
  }
  const config = parsed.data as TemplateConfig;
  const sectionKeys = new Set<string>();
  for (const section of config.sections) {
    if (sectionKeys.has(section.key)) throw validationError(`Section key "${section.key}" is used twice.`);
    sectionKeys.add(section.key);
    for (const kind of section.kinds ?? []) if (!KINDS[kind]) throw validationError(`Section "${section.title}" lists an unknown item type "${kind}".`);
  }
  const questionKeys = new Set<string>();
  for (const step of config.steps) {
    for (const question of step.questions) {
      if (questionKeys.has(question.key)) throw validationError(`Question key "${question.key}" is used twice.`);
      questionKeys.add(question.key);
      if (!sectionKeys.has(question.section)) throw validationError(`Question "${question.label}" points to a missing section "${question.section}".`);
      if (question.generates && !KINDS[question.generates]) throw validationError(`Question "${question.label}" generates an unknown item type.`);
      if (question.type === "choice" && !question.options?.length) throw validationError(`Question "${question.label}" needs options.`);
    }
  }
  for (const kind of config.requiredKinds) if (!KINDS[kind]) throw validationError(`Unknown required item type "${kind}".`);
  return config;
}

export async function ensureSrsTemplates(db: Db, organizationId: string) {
  const existing = await db.srsTemplate.count({ where: { organizationId } });
  if (existing >= PROJECT_TYPES.length + 1) return;
  const entries: Array<[string, string, string, boolean]> = [["master", "Master SRS template", "custom", true], ...PROJECT_TYPES.map(([type, label]) => [type, label, type, false] as [string, string, string, boolean])];
  for (const [templateKey, name, projectType, isMaster] of entries) {
    const found = await db.srsTemplate.findUnique({ where: { organizationId_key: { organizationId, key: templateKey } } });
    if (found) continue;
    try {
      await db.srsTemplate.create({
        data: {
          organizationId,
          key: templateKey,
          name,
          projectType,
          isMaster,
          description: isMaster ? "Base structure every SRS starts from." : `Questions and required sections tuned for ${name.toLowerCase()} projects.`,
          versions: { create: { version: 1, config: JSON.stringify(defaultTemplateConfig(projectType)), createdByName: "System", note: "Initial template" } },
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
}

export async function templateVersionFor(db: Db, organizationId: string, projectType: string) {
  await ensureSrsTemplates(db, organizationId);
  const template =
    (await db.srsTemplate.findFirst({ where: { organizationId, projectType, active: true, isMaster: false } })) ??
    (await db.srsTemplate.findFirstOrThrow({ where: { organizationId, key: "master" } }));
  return db.srsTemplateVersion.findUniqueOrThrow({ where: { templateId_version: { templateId: template.id, version: template.currentVersion } }, include: { template: true } });
}

export async function listTemplates(actor: Actor) {
  requirePermission(actor, "srs.templates");
  await ensureSrsTemplates(prisma, actor.organizationId);
  const templates = await prisma.srsTemplate.findMany({ where: { organizationId: actor.organizationId }, orderBy: [{ isMaster: "desc" }, { name: "asc" }] });
  const usage = await prisma.srsDocument.groupBy({ by: ["templateVersionId"], where: { organizationId: actor.organizationId }, _count: true });
  const versions = await prisma.srsTemplateVersion.findMany({ where: { templateId: { in: templates.map((t) => t.id) } }, select: { id: true, templateId: true } });
  return templates.map((template) => ({
    ...template,
    documents: usage.filter((row) => versions.some((v) => v.id === row.templateVersionId && v.templateId === template.id)).reduce((sum, row) => sum + row._count, 0),
  }));
}

export async function getTemplate(actor: Actor, id: string) {
  requirePermission(actor, "srs.templates");
  const template = await prisma.srsTemplate.findFirst({ where: { id, organizationId: actor.organizationId }, include: { versions: { orderBy: { version: "desc" } } } });
  if (!template) throw notFound("Template not found.");
  const current = template.versions.find((v) => v.version === template.currentVersion)!;
  return { template, current, config: parseTemplateConfig(current.config) };
}

export async function saveTemplateVersion(actor: Actor, id: string, input: { config: unknown; note: string; expectedVersion: number; active?: boolean }) {
  requirePermission(actor, "srs.templates");
  const config = parseTemplateConfig(input.config);
  return prisma.$transaction(async (tx) => {
    const template = await tx.srsTemplate.findFirst({ where: { id, organizationId: actor.organizationId } });
    if (!template) throw notFound("Template not found.");
    if (template.currentVersion !== input.expectedVersion) throw conflict("Someone else saved this template. Reload to see their changes.");
    const next = template.currentVersion + 1;
    await tx.srsTemplateVersion.create({ data: { templateId: id, version: next, config: JSON.stringify(config), note: input.note.slice(0, 300), createdById: actor.userId, createdByName: actor.name } });
    const updated = await tx.srsTemplate.updateMany({ where: { id, currentVersion: template.currentVersion }, data: { currentVersion: next, ...(input.active === undefined ? {} : { active: input.active }) } });
    if (updated.count !== 1) throw conflict("Someone else saved this template. Reload to see their changes.");
    await writeAudit(tx, actor, { action: "srs.template.version", entityType: "srs_template", entityId: id, before: { version: template.currentVersion }, after: { version: next, note: input.note } });
    return { version: next };
  });
}
