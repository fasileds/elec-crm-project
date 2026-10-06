import Link from "next/link";
import { Empty, PageHeader } from "@/components/ui";
import { searchAll } from "@/lib/domain/insights";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireEmployee();
  const { q = "" } = await searchParams;
  const result = q.trim().length >= 2 ? await searchAll(actor, q) : null;
  return (
    <main>
      <PageHeader kicker="Search" title={q ? `Results for “${q}”` : "Search"} lede="Results stay inside your organization and your permissions." />
      {!result ? <Empty title="Type at least two characters" body="Search customers, contacts, projects, tasks, requirements, files, and people." /> : (
        <div className="grid two">
          <Result title="Customers" rows={result.customers.map((item) => ({ href: `/customers/${item.id}`, label: `${item.code} ${item.name}` }))} />
          <Result title="Projects" rows={result.projects.map((item) => ({ href: `/projects/${item.id}`, label: `${item.code} ${item.name}` }))} />
          <Result title="Tasks" rows={result.tasks.map((item) => ({ href: `/projects/${item.projectId}`, label: `${item.code} ${item.title}` }))} />
          <Result title="People" rows={result.people.map((item) => ({ href: "/people", label: item.name }))} />
        </div>
      )}
    </main>
  );
}

function Result({ title, rows }: { title: string; rows: Array<{ href: string; label: string }> }) {
  return <article className="card"><h2>{title}</h2>{rows.length === 0 ? <p className="meta">Nothing in this group.</p> : rows.map((row) => <Link className="item" key={row.href + row.label} href={row.href}>{row.label}</Link>)}</article>;
}
