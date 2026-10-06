import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { requireEmployee, requirePermission, requireRecentAuth } from "@/lib/actor";
import { revokeUserSessions } from "@/lib/domain/auth";
import { writeAudit } from "@/lib/domain/support";
import { conflict, validationError } from "@/lib/errors";

export async function listPeople(actor: Actor, query: { q?: string; status?: string }) {
  requirePermission(actor, "employees.view");
  const q = query.q?.trim().toLowerCase();
  return prisma.user.findMany({
    where: {
      organizationId: actor.organizationId,
      kind: "employee",
      ...(query.status ? { status: query.status } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      jobTitle: true,
      department: { select: { name: true } },
      roles: { include: { role: { select: { key: true, name: true } } } },
    },
  });
}

export async function updateEmployee(actor: Actor, id: string, input: { jobTitle?: string; departmentId?: string | null; managerId?: string | null; roleKeys?: string[]; status?: "active" | "inactive" }) {
  requirePermission(actor, "employees.manage");
  const user = await prisma.user.findFirst({ where: { id, organizationId: actor.organizationId, kind: "employee" } });
  if (!user) throw validationError("Employee not found.");
  if (input.status === "inactive") {
    requireRecentAuth(actor);
    if (user.id === actor.userId) throw conflict("You cannot disable your own account.");
  }
  if (input.roleKeys) requireRecentAuth(actor);
  await prisma.user.update({
    where: { id },
    data: {
      jobTitle: input.jobTitle,
      departmentId: input.departmentId,
      managerId: input.managerId,
      status: input.status,
      deactivatedAt: input.status === "inactive" ? new Date() : input.status === "active" ? null : undefined,
    },
  });
  if (input.roleKeys) {
    const roleKeys = input.roleKeys.filter((key) => key !== "customer");
    const roles = await prisma.role.findMany({ where: { organizationId: actor.organizationId, key: { in: roleKeys } } });
    if (roles.length !== roleKeys.length) throw validationError("One or more roles are unavailable.");
    await prisma.userRole.deleteMany({ where: { userId: id } });
    await prisma.userRole.createMany({ data: roles.map((role) => ({ userId: id, roleId: role.id })) });
  }
  if (input.status === "inactive") await revokeUserSessions(id);
  await writeAudit(prisma, actor, { action: "employee.update", entityType: "user", entityId: id, after: { status: input.status, roleKeys: input.roleKeys } });
}

export async function workload(actor: Actor) {
  requireEmployee(actor);
  const tasks = await prisma.task.findMany({
    where: { organizationId: actor.organizationId, status: { in: ["ready", "in_progress", "blocked", "in_review"] }, assigneeId: { not: null } },
    select: { assigneeId: true, estimatedMinutes: true, assignee: { select: { name: true, status: true } } },
  });
  const totals = new Map<string, { name: string; minutes: number; tasks: number; inactive: boolean }>();
  for (const task of tasks) {
    if (!task.assigneeId || !task.assignee) continue;
    const current = totals.get(task.assigneeId) ?? { name: task.assignee.name, minutes: 0, tasks: 0, inactive: task.assignee.status !== "active" };
    current.minutes += task.estimatedMinutes;
    current.tasks += 1;
    totals.set(task.assigneeId, current);
  }
  return [...totals.entries()].map(([id, value]) => ({ id, ...value })).sort((a, b) => b.minutes - a.minutes);
}

export async function createEmployeeDirect(actor: Actor, input: { name: string; email: string; password: string; roleKey: string; jobTitle?: string }) {
  requirePermission(actor, "employees.manage");
  requireRecentAuth(actor);
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw conflict("An account with this email already exists.");
  const role = await prisma.role.findFirst({ where: { organizationId: actor.organizationId, key: input.roleKey } });
  if (!role || role.key === "customer") throw validationError("Choose an employee role.");
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: {
      organizationId: actor.organizationId,
      email,
      name: input.name.trim(),
      passwordHash,
      kind: "employee",
      status: "active",
      emailVerifiedAt: new Date(),
      jobTitle: input.jobTitle,
      roles: { create: { roleId: role.id } },
    },
  });
  await writeAudit(prisma, actor, { action: "employee.create", entityType: "user", entityId: user.id, after: { email, role: role.key } });
  return { id: user.id };
}
