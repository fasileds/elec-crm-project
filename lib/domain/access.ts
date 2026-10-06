import type { Actor } from "@/lib/actor";
import { can } from "@/lib/actor";
import { notFound } from "@/lib/errors";
import type { Db } from "@/lib/domain/support";

export async function loadCustomer(db: Db, actor: Actor, id: string) {
  if (actor.kind === "customer" && id !== actor.customerId) throw notFound("Customer not found.");
  const customer = await db.customer.findFirst({
    where: { id, organizationId: actor.organizationId },
  });
  if (!customer) throw notFound("Customer not found.");
  if (actor.kind === "employee" && !can(actor, "customers.view") && customer.accountManagerId !== actor.userId) {
    const linked = await db.project.findFirst({
      where: {
        customerId: customer.id,
        OR: [{ managerId: actor.userId }, { members: { some: { userId: actor.userId } } }],
      },
      select: { id: true },
    });
    if (!linked) throw notFound("Customer not found.");
  }
  return customer;
}

export async function loadProject(db: Db, actor: Actor, id: string) {
  const project = await db.project.findFirst({
    where: {
      id,
      organizationId: actor.organizationId,
      ...(actor.kind === "customer" ? { customerId: actor.customerId ?? "__none__" } : {}),
    },
  });
  if (!project) throw notFound("Project not found.");
  if (actor.kind === "employee" && !can(actor, "projects.view") && project.managerId !== actor.userId) {
    const member = await db.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: actor.userId } },
    });
    if (!member) throw notFound("Project not found.");
  }
  return project;
}

export function projectListScope(actor: Actor) {
  if (actor.kind === "customer") return { customerId: actor.customerId ?? "__none__" };
  if (can(actor, "projects.view")) return {};
  return { OR: [{ managerId: actor.userId }, { members: { some: { userId: actor.userId } } }] };
}

export function customerListScope(actor: Actor) {
  if (actor.kind === "customer") return { id: actor.customerId ?? "__none__" };
  if (can(actor, "customers.view")) return {};
  return {
    OR: [
      { accountManagerId: actor.userId },
      { projects: { some: { OR: [{ managerId: actor.userId }, { members: { some: { userId: actor.userId } } }] } } },
    ],
  };
}
