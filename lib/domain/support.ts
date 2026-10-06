import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/actor";
import { prisma } from "@/lib/db";
import { conflict, notFound, validationError } from "@/lib/errors";
import { log } from "@/lib/log";
import { redact } from "@/lib/text";

export type Db = Prisma.TransactionClient | typeof prisma;

export function newSecret() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashSecret(token) };
}

export function hashSecret(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function nextCode(db: Db, organizationId: string, name: string, prefix: string) {
  const row = await db.sequence.upsert({
    where: { organizationId_name: { organizationId, name } },
    create: { organizationId, name, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${String(row.value).padStart(4, "0")}`;
}

export async function writeAudit(
  db: Db,
  actor: Pick<Actor, "organizationId" | "userId" | "name">,
  input: {
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    metadata?: Record<string, unknown>;
    requestId?: string;
  },
) {
  await db.auditLog.create({
    data: {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      actorName: actor.name,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before == null ? null : JSON.stringify(redact(input.before)),
      after: input.after == null ? null : JSON.stringify(redact(input.after)),
      metadata: JSON.stringify(redact(input.metadata ?? {})),
      requestId: input.requestId,
    },
  });
}

export async function writeActivity(
  db: Db,
  actor: Pick<Actor, "organizationId" | "userId" | "name">,
  input: {
    type: string;
    summary: string;
    visibility?: "internal" | "customer";
    customerId?: string | null;
    projectId?: string | null;
    entityType?: string;
    entityId?: string;
  },
) {
  await db.activity.create({
    data: {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      actorName: actor.name,
      type: input.type,
      summary: input.summary,
      visibility: input.visibility ?? "internal",
      customerId: input.customerId ?? null,
      projectId: input.projectId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
    },
  });
}

export async function notifyUser(
  db: Db,
  input: {
    organizationId: string;
    userId: string;
    type: string;
    title: string;
    body: string;
    href: string;
    dedupeKey: string;
    email?: { to: string; template: string; payload: Record<string, string>; mandatory?: boolean };
  },
) {
  const preference = await db.notificationPreference.findUnique({
    where: { userId_eventType: { userId: input.userId, eventType: input.type } },
  });
  if (preference?.inApp !== false) {
    await db.notification.upsert({
      where: { userId_dedupeKey: { userId: input.userId, dedupeKey: input.dedupeKey } },
      update: {},
      create: {
        organizationId: input.organizationId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        href: input.href,
        dedupeKey: input.dedupeKey,
      },
    });
  }
  if (input.email && (input.email.mandatory || preference?.email !== false)) {
    await db.emailMessage.upsert({
      where: { dedupeKey: `${input.dedupeKey}:email:${input.userId}` },
      update: {},
      create: {
        organizationId: input.organizationId,
        userId: input.userId,
        toEmail: input.email.to,
        template: input.email.template,
        payload: JSON.stringify(input.email.payload),
        dedupeKey: `${input.dedupeKey}:email:${input.userId}`,
        mandatory: Boolean(input.email.mandatory),
        status: "queued",
      },
    });
  }
}

export async function replayOrClaim(db: Db, actor: Actor, key: string | null | undefined, resourceType: string) {
  if (!key) return null;
  const existing = await db.idempotencyRecord.findUnique({
    where: { actorId_key: { actorId: actor.userId, key } },
  });
  if (!existing) return null;
  if (existing.resourceType !== resourceType) {
    throw conflict("This submission was already used for a different action.");
  }
  return existing.resourceId;
}

export async function rememberIdempotency(db: Db, actor: Actor, key: string | null | undefined, resourceType: string, resourceId: string) {
  if (!key) return;
  await db.idempotencyRecord.create({
    data: {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      key,
      resourceType,
      resourceId,
    },
  });
}

export async function assertEnabledLookup(db: Db, organizationId: string, kind: string, key: string | null | undefined) {
  if (!key) return;
  const option = await db.lookupOption.findUnique({
    where: { organizationId_kind_key: { organizationId, kind, key } },
  });
  if (!option?.enabled) {
    throw validationError(`"${key}" is not an available option.`, { [kind]: "Choose an enabled option." });
  }
}

export async function bumpVersion<T extends { id: string; version: number }>(
  updateMany: (args: { where: { id: string; version: number }; data: Record<string, unknown> }) => Promise<{ count: number }>,
  current: T,
  data: Record<string, unknown>,
) {
  const result = await updateMany({
    where: { id: current.id, version: current.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (result.count !== 1) {
    throw conflict("Someone else updated this record. Reload it and try again.");
  }
}

export async function requireRecord<T>(record: T | null, message?: string): Promise<T> {
  if (!record) throw notFound(message);
  return record;
}

export function appUrl(path: string) {
  const base = process.env.APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function processOutbox(limit = 20) {
  const { renderTemplate } = await import("@/lib/email/templates");
  const pending = await prisma.emailMessage.findMany({
    where: { status: { in: ["queued", "failed"] }, attempts: { lt: 5 } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  for (const message of pending) {
    const claimed = await prisma.emailMessage.updateMany({
      where: { id: message.id, status: { in: ["queued", "failed"] } },
      data: { status: "sending" },
    });
    if (claimed.count !== 1) continue;

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: "failed", attempts: { increment: 1 }, lastError: "Email is not configured." },
      });
      log("warn", "email.not_configured", { emailId: message.id, template: message.template });
      continue;
    }

    try {
      const payload = JSON.parse(message.payload) as Record<string, string>;
      const rendered = renderTemplate(message.template, payload);
      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);
      const result = await resend.emails.send({
        from,
        to: message.toEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: "sent", sentAt: new Date(), providerId: result.data?.id ?? null, lastError: null },
      });
      log("info", "email.sent", { emailId: message.id, template: message.template, providerId: result.data?.id });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Email provider failed.";
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: "failed", attempts: { increment: 1 }, lastError: reason.slice(0, 300) },
      });
      log("error", "email.failed", { emailId: message.id, template: message.template, reason });
    }
  }
}

export function scheduleOutbox() {
  void processOutbox().catch((error: unknown) => {
    log("error", "email.outbox_failed", { reason: error instanceof Error ? error.message : "unknown" });
  });
}
