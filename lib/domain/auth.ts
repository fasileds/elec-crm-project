import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { conflict, forbidden, rateLimited, unauthorized, validationError } from "@/lib/errors";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "@/lib/cookies";
import { appUrl, hashSecret, newSecret, notifyUser, scheduleOutbox, writeAudit } from "@/lib/domain/support";

const RESET_MS = 60 * 60 * 1000;
const VERIFY_MS = 24 * 60 * 60 * 1000;
const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

export function assertPasswordPolicy(password: string, email: string) {
  if (password.length < 10 || password.length > 200) {
    throw validationError("Use at least 10 characters.", { password: "Use at least 10 characters." });
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password) || !/[^a-zA-Z0-9]/.test(password)) {
    throw validationError("Use a letter, a number, and a symbol.", { password: "Use a letter, a number, and a symbol." });
  }
  if (password.toLowerCase() === email.toLowerCase()) {
    throw validationError("Password cannot match the email address.", { password: "Choose a different password." });
  }
}

async function registerFailure(key: string) {
  const now = new Date();
  const current = await prisma.authAttempt.findUnique({ where: { key } });
  if (!current || now.getTime() - current.windowStart.getTime() > WINDOW_MS) {
    await prisma.authAttempt.upsert({
      where: { key },
      create: { key, failures: 1, windowStart: now },
      update: { failures: 1, windowStart: now, lockedUntil: null },
    });
    return;
  }
  const failures = current.failures + 1;
  await prisma.authAttempt.update({
    where: { key },
    data: {
      failures,
      lockedUntil: failures >= MAX_FAILURES ? new Date(now.getTime() + WINDOW_MS) : null,
    },
  });
}

async function assertNotLocked(key: string) {
  const current = await prisma.authAttempt.findUnique({ where: { key } });
  if (current?.lockedUntil && current.lockedUntil > new Date()) throw rateLimited();
}

export async function loginWithPassword(input: { email: string; password: string; ip?: string; userAgent?: string }) {
  const email = input.email.trim().toLowerCase();
  const key = `login:${input.ip ?? "unknown"}:${email}`;
  await assertNotLocked(key);
  const user = await prisma.user.findUnique({
    where: { email },
    include: { organization: true, customer: true, roles: { include: { role: { include: { permissions: true } } } } },
  });
  const valid = user ? await bcrypt.compare(input.password, user.passwordHash) : false;
  if (!user || !valid) {
    await registerFailure(key);
    throw unauthorized("Email or password is incorrect.");
  }
  if (user.status !== "active" || user.deactivatedAt) {
    throw unauthorized("This account is disabled.");
  }
  if (!user.emailVerifiedAt) throw unauthorized("Verify your email before signing in.");
  if (user.kind === "customer" && user.customer?.archivedAt) {
    throw unauthorized("This customer workspace is archived.");
  }
  await prisma.authAttempt.deleteMany({ where: { key } });
  const secret = newSecret();
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: secret.hash,
      expiresAt: new Date(Date.now() + SESSION_IDLE_MS),
      userAgent: input.userAgent?.slice(0, 240),
      ip: input.ip?.slice(0, 64),
      lastAuthenticatedAt: new Date(),
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { token: secret.token, sessionId: session.id, actor: toActor(user, session.id, session.lastAuthenticatedAt) };
}

export async function actorFromToken(token: string | undefined | null) {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: {
      user: { include: { organization: true, customer: true, roles: { include: { role: { include: { permissions: true } } } } } },
    },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  const user = session.user;
  if (user.status !== "active" || user.deactivatedAt) return null;
  if (user.kind === "customer" && user.customer?.archivedAt) return null;
  const absoluteEnd = session.createdAt.getTime() + SESSION_ABSOLUTE_MS;
  if (session.expiresAt.getTime() - Date.now() < 2 * 60 * 60 * 1000 && Date.now() < absoluteEnd) {
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Math.min(Date.now() + SESSION_IDLE_MS, absoluteEnd)) },
    });
  }
  return toActor(user, session.id, session.lastAuthenticatedAt);
}

function toActor(
  user: {
    id: string;
    organizationId: string;
    customerId: string | null;
    kind: string;
    email: string;
    name: string;
    timezone: string | null;
    organization: { timezone: string; locale: string; currency: string };
    roles: Array<{ role: { permissions: Array<{ permission: string }> } }>;
  },
  sessionId: string,
  lastAuthenticatedAt: Date,
): Actor {
  const permissions = [...new Set(user.roles.flatMap((entry) => entry.role.permissions.map((item) => item.permission)))];
  return {
    userId: user.id,
    organizationId: user.organizationId,
    customerId: user.customerId,
    kind: user.kind === "customer" ? "customer" : "employee",
    email: user.email,
    name: user.name,
    permissions,
    sessionId,
    lastAuthenticatedAt,
    timezone: user.timezone || user.organization.timezone,
    locale: user.organization.locale,
    currency: user.organization.currency,
  };
}

export async function logout(sessionId: string) {
  await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function requestPasswordReset(emailRaw: string) {
  const email = emailRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email }, include: { organization: true } });
  if (!user || user.status !== "active") return;
  const secret = newSecret();
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: secret.hash, expiresAt: new Date(Date.now() + RESET_MS) },
  });
  await notifyUser(prisma, {
    organizationId: user.organizationId,
    userId: user.id,
    type: "password_reset",
    title: "Password reset",
    body: "A password reset link was sent.",
    href: "/login",
    dedupeKey: `reset:${secret.hash}`,
    email: {
      to: user.email,
      template: "password_reset",
      mandatory: true,
      payload: { email: user.email, url: appUrl(`/reset-password?token=${secret.token}`) },
    },
  });
  scheduleOutbox();
}

export async function resetPassword(token: string, password: string) {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashSecret(token) }, include: { user: true } });
  if (!record) throw validationError("This reset link is invalid.");
  if (record.usedAt) throw conflict("This reset link has already been used.");
  if (record.expiresAt <= new Date()) throw validationError("This reset link has expired.");
  assertPasswordPolicy(password, record.user.email);
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash, passwordChangedAt: new Date(), emailVerifiedAt: record.user.emailVerifiedAt ?? new Date() } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}

export async function sendVerification(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { organization: true } });
  if (!user || user.emailVerifiedAt) return;
  const secret = newSecret();
  await prisma.emailVerificationToken.create({
    data: { userId: user.id, tokenHash: secret.hash, expiresAt: new Date(Date.now() + VERIFY_MS) },
  });
  await notifyUser(prisma, {
    organizationId: user.organizationId,
    userId: user.id,
    type: "verify_email",
    title: "Verify your email",
    body: "A verification link was sent.",
    href: "/login",
    dedupeKey: `verify:${secret.hash}`,
    email: {
      to: user.email,
      template: "verify_email",
      mandatory: true,
      payload: { email: user.email, organization: user.organization.name, url: appUrl(`/verify-email?token=${secret.token}`) },
    },
  });
  scheduleOutbox();
}

export async function verifyEmail(token: string) {
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashSecret(token) } });
  if (!record) throw validationError("This verification link is invalid.");
  if (record.usedAt) throw conflict("This verification link has already been used.");
  if (record.expiresAt <= new Date()) throw validationError("This verification link has expired.");
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
}

export async function createInvitation(
  actor: Actor,
  input: { email: string; name: string; kind: "employee" | "customer"; roleKeys: string[]; customerId?: string; contactId?: string },
) {
  if (input.kind === "customer" && !input.customerId) throw validationError("Choose a customer for this invitation.");
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw conflict("An account with this email already exists.");
  const secret = newSecret();
  const invitation = await prisma.invitation.create({
    data: {
      organizationId: actor.organizationId,
      email,
      name: input.name.trim(),
      kind: input.kind,
      roleKeys: input.roleKeys.join(","),
      customerId: input.customerId,
      contactId: input.contactId,
      tokenHash: secret.hash,
      expiresAt: new Date(Date.now() + INVITE_MS),
      invitedById: actor.userId,
    },
  });
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: actor.organizationId } });
  await prisma.emailMessage.create({
    data: {
      organizationId: actor.organizationId,
      toEmail: email,
      template: "invitation",
      payload: JSON.stringify({
        organization: organization.name,
        inviter: actor.name,
        role: input.roleKeys.join(", "),
        url: appUrl(`/invite?token=${secret.token}`),
      }),
      dedupeKey: `invite:${invitation.id}`,
      mandatory: true,
      status: "queued",
    },
  });
  await writeAudit(prisma, actor, { action: "invitation.create", entityType: "invitation", entityId: invitation.id, after: { email, kind: input.kind } });
  scheduleOutbox();
  return { id: invitation.id };
}

export async function acceptInvitation(token: string, password: string) {
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashSecret(token) } });
  if (!invitation) throw validationError("This invitation is invalid.");
  if (invitation.revokedAt) throw conflict("This invitation has been revoked.");
  if (invitation.acceptedAt) throw conflict("This invitation has already been used.");
  if (invitation.expiresAt <= new Date()) throw validationError("This invitation has expired.");
  assertPasswordPolicy(password, invitation.email);
  const existing = await prisma.user.findUnique({ where: { email: invitation.email } });
  if (existing) throw conflict("An account with this email already exists.");
  const passwordHash = await bcrypt.hash(password, 12);
  const roleKeys = invitation.roleKeys.split(",").filter(Boolean);
  const roles = await prisma.role.findMany({ where: { organizationId: invitation.organizationId, key: { in: roleKeys } } });
  if (roles.length !== roleKeys.length) throw forbidden("One or more invitation roles are no longer available.");
  const user = await prisma.user.create({
    data: {
      organizationId: invitation.organizationId,
      customerId: invitation.customerId,
      contactId: invitation.contactId,
      email: invitation.email,
      name: invitation.name,
      passwordHash,
      kind: invitation.kind,
      status: "active",
      emailVerifiedAt: new Date(),
      roles: { create: roles.map((role) => ({ roleId: role.id })) },
    },
  });
  await prisma.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
  if (invitation.contactId) {
    await prisma.contact.update({ where: { id: invitation.contactId }, data: { portalAccess: true } });
  }
  return user.id;
}

export async function revokeInvitation(actor: Actor, id: string) {
  const invitation = await prisma.invitation.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!invitation) throw unauthorized("Invitation not found.");
  if (invitation.acceptedAt) throw conflict("Accepted invitations cannot be revoked.");
  await prisma.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
  await writeAudit(prisma, actor, { action: "invitation.revoke", entityType: "invitation", entityId: id });
}

export async function confirmPassword(actor: Actor, password: string) {
  const user = await prisma.user.findUnique({ where: { id: actor.userId } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw unauthorized("Password confirmation failed.");
  await prisma.session.update({ where: { id: actor.sessionId }, data: { lastAuthenticatedAt: new Date() } });
}

export async function revokeUserSessions(userId: string) {
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
