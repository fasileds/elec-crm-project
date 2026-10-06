import { Shell } from "@/components/shell";
import { prisma } from "@/lib/db";
import { listNotifications } from "@/lib/domain/insights";
import { requireEmployee } from "@/lib/session";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireEmployee();
  const [notes, organization] = await Promise.all([
    listNotifications(actor),
    prisma.organization.findUnique({ where: { id: actor.organizationId }, select: { name: true } }),
  ]);
  return <Shell name={actor.name} email={actor.email} unread={notes.unread} organization={organization?.name ?? "Elec Novatech"} permissions={actor.permissions}>{children}</Shell>;
}
