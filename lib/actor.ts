import { forbidden } from "@/lib/errors";
import { hasPermission, type Permission } from "@/lib/permissions";

export type Actor = {
  userId: string;
  organizationId: string;
  customerId: string | null;
  kind: "employee" | "customer";
  email: string;
  name: string;
  permissions: string[];
  sessionId: string;
  lastAuthenticatedAt: Date;
  timezone: string;
  locale: string;
  currency: string;
};

export function can(actor: Actor, permission: Permission) {
  return hasPermission(actor.permissions, permission);
}

export function requirePermission(actor: Actor, permission: Permission) {
  if (!can(actor, permission)) {
    throw forbidden("You do not have permission to do that.");
  }
}

export function requireEmployee(actor: Actor) {
  if (actor.kind !== "employee") throw forbidden("This action is only available to employees.");
}

export function requireRecentAuth(actor: Actor, minutes = 15) {
  const age = Date.now() - actor.lastAuthenticatedAt.getTime();
  if (age > minutes * 60 * 1000) {
    throw forbidden("Confirm your password before this sensitive change.");
  }
}

export function assertCustomerScope(actor: Actor, customerId: string | null | undefined) {
  if (actor.kind === "customer" && actor.customerId !== customerId) {
    throw forbidden("You can only access your own organization.");
  }
}
