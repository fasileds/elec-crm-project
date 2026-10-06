import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, Empty, PageHeader, Pager, Panel, Person, Tabs } from "@/components/ui";
import { can } from "@/lib/actor";
import { formatDate } from "@/lib/dates";
import { listCustomers } from "@/lib/domain/customers";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "Customers" };

const VIEWS: Array<[string, string]> = [
  ["", "All"],
  ["active", "Active"],
  ["onboarding", "Onboarding"],
  ["opportunity", "Opportunity"],
  ["proposal", "Proposal"],
  ["negotiation", "Negotiation"],
  ["completed", "Completed"],
  ["inactive", "Inactive"],
  ["archived", "Archived"],
];

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string; sort?: string }> }) {
  const actor = await requireEmployee();
  const query = await searchParams;
  const status = query.status ?? "";
  const result = await listCustomers(actor, { q: query.q, status: status || undefined, sort: query.sort, page: Number(query.page ?? 1) });
  const href = (next: { status?: string; page?: number }) => {
    const params = new URLSearchParams();
    const nextStatus = next.status ?? status;
    if (nextStatus) params.set("status", nextStatus);
    if (query.q) params.set("q", query.q);
    if (query.sort) params.set("sort", query.sort);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const text = params.toString();
    return text ? `/customers?${text}` : "/customers";
  };

  return (
    <main>
      <PageHeader
        title="Customers"
        lede="Every account from first conversation through delivery and archive."
        action={can(actor, "customers.create") ? <Link className="btn btn-primary" href="/customers/new"><Plus size={15} aria-hidden="true" />New customer</Link> : null}
      />
      <Tabs label="Customer status" items={VIEWS.map(([value, label]) => ({ href: href({ status: value, page: 1 }), label, current: status === value }))} />

      <Panel flush footer={<Pager page={result.page} pageSize={result.pageSize} total={result.total} href={(page) => href({ page })} />}>
        <form className="toolbar" action="/customers">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <input name="q" type="search" defaultValue={query.q} placeholder="Search name, code or industry" aria-label="Search customers" />
          <select name="sort" defaultValue={query.sort ?? ""} aria-label="Sort"><option value="">Recently updated</option><option value="name">Name A–Z</option></select>
          <button className="btn btn-secondary" type="submit">Apply</button>
          {query.q || query.sort ? <Link className="btn btn-ghost" href={status ? `/customers?status=${status}` : "/customers"}>Clear</Link> : null}
        </form>
        {result.items.length === 0 ? <Empty title="No customers match" body="Create a customer or clear the filters." href={can(actor, "customers.create") ? "/customers/new" : undefined} action="New customer" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Status</th><th>Industry</th><th>Account manager</th><th className="right">Projects</th><th className="right">Contacts</th><th>Tags</th><th>Updated</th></tr></thead>
              <tbody>
                {result.items.map((customer) => (
                  <tr key={customer.id}>
                    <td><Link href={`/customers/${customer.id}`}><strong>{customer.name}</strong></Link><div className="meta">{customer.code}{customer.website ? ` · ${customer.website.replace(/^https?:\/\//, "")}` : ""}</div></td>
                    <td><Badge value={customer.status} /></td>
                    <td>{customer.industry ?? <span className="meta">—</span>}</td>
                    <td><Person name={customer.accountManager?.name} inactive={customer.accountManager?.status === "inactive"} /></td>
                    <td className="right num">{customer.projectCount}</td>
                    <td className="right num">{customer.contactCount}</td>
                    <td>{customer.tags.length ? <span className="row" style={{ justifyContent: "flex-start", gap: 4, flexWrap: "wrap" }}>{customer.tags.slice(0, 3).map((tag) => <span className="chip" key={tag}>{tag}</span>)}</span> : <span className="meta">—</span>}</td>
                    <td className="nowrap meta">{formatDate(customer.updatedAt, actor.timezone, actor.locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </main>
  );
}
