import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { searchAll } from "@/lib/domain/insights";
import { requireCustomer } from "@/lib/session";

export const metadata = { title: "Search" };

export default async function PortalSearch({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireCustomer();
  const { q = "" } = await searchParams;
  const result = q.trim().length >= 2 ? await searchAll(actor, q) : null;
  return (
    <main>
      <PageHeader kicker="Search" title="Find your work" />
      {result ? result.projects.map((project) => <Link key={project.id} className="item" href={`/portal/projects/${project.id}`}>{project.name}</Link>) : <p>Enter at least two characters.</p>}
    </main>
  );
}
