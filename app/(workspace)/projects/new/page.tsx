import { ProjectCreateForm } from "@/components/project-create-form";
import { PageHeader } from "@/components/ui";
import { listCustomers } from "@/lib/domain/customers";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "New project" };

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  const actor = await requireEmployee();
  const { customerId } = await searchParams;
  const customers = await listCustomers(actor, { page: 1 });
  return (
    <main>
      <PageHeader kicker="Delivery" title="New project" lede="A project opens in draft with discovery through maintenance phases and a required onboarding checklist." />
      <ProjectCreateForm customers={customers.items.map((customer) => ({ id: customer.id, name: customer.name, code: customer.code }))} customerId={customerId} />
    </main>
  );
}
