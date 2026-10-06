import { Shell } from "@/components/shell";
import { prisma } from "@/lib/db";
import { listNotifications } from "@/lib/domain/insights";
import { requireCustomer } from "@/lib/session";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireCustomer();
  const [notes, organization] = await Promise.all([
    listNotifications(actor),
    prisma.organization.findUnique({ where: { id: actor.organizationId }, select: { name: true } }),
  ]);
  return <Shell portal searchPath="/portal/search" name={actor.name} email={actor.email} unread={notes.unread} organization={organization?.name ?? "Elec Novatech"}>{children}</Shell>;
}
