import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, Empty, PageHeader, Pager, Panel, Person, Tabs } from "@/components/ui";
import { can } from "@/lib/actor";
import { formatDate } from "@/lib/dates";
import { listProjects } from "@/lib/domain/projects";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "Projects" };

const STATUSES = ["draft", "proposed", "approved", "onboarding", "planning", "active", "on_hold", "blocked", "completed", "delivered", "cancelled", "archived"];
const VIEWS: Array<[string, string]> = [["", "Open"], ["active", "Active"], ["onboarding", "Onboarding"], ["planning", "Planning"], ["on_hold", "On hold"], ["blocked", "Blocked"], ["completed", "Completed"], ["archived", "Archived"]];

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; health?: string; page?: string }> }) {
  const actor = await requireEmployee();
  const query = await searchParams;
  const status = query.status ?? "";
  const result = await listProjects(actor, { q: query.q, status: status || undefined, health: query.health, page: Number(query.page ?? 1) });
  const today = new Date().toISOString().slice(0, 10);
  const href = (next: { status?: string; page?: number }) => {
    const params = new URLSearchParams();
    const nextStatus = next.status ?? status;
    if (nextStatus) params.set("status", nextStatus);
    if (query.q) params.set("q", query.q);
    if (query.health) params.set("health", query.health);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const text = params.toString();
    return text ? `/projects?${text}` : "/projects";
  };
  const primaryView = VIEWS.some(([value]) => value === status);

  return (
    <main>
      <PageHeader
        title="Projects"
        lede="Health is calculated from overdue work, blockers, deadlines and scope changes."
        action={can(actor, "projects.create") ? <Link className="btn btn-primary" href="/projects/new"><Plus size={15} aria-hidden="true" />New project</Link> : null}
      />
      <Tabs label="Project status" items={VIEWS.map(([value, label]) => ({ href: href({ status: value, page: 1 }), label, current: primaryView && status === value }))} />

      <Panel flush footer={<Pager page={result.page} pageSize={result.pageSize} total={result.total} href={(page) => href({ page })} />}>
        <form className="toolbar" action="/projects">
          <input name="q" type="search" defaultValue={query.q} placeholder="Search projects" aria-label="Search projects" />
          <select name="status" defaultValue={status} aria-label="Project status"><option value="">All open</option>{STATUSES.map((value) => <option key={value} value={value}>{value.replace("_", " ")}</option>)}</select>
          <select name="health" defaultValue={query.health ?? ""} aria-label="Health"><option value="">Any health</option><option value="healthy">Healthy</option><option value="watch">Watch</option><option value="at_risk">At risk</option><option value="critical">Critical</option></select>
          <button className="btn btn-secondary" type="submit">Apply</button>
          {query.q || query.health ? <Link className="btn btn-ghost" href={status ? `/projects?status=${status}` : "/projects"}>Clear</Link> : null}
        </form>
        {result.items.length === 0 ? <Empty title="No projects in this view" body="Start a project from an active customer, or clear the filters." href={can(actor, "projects.create") ? "/projects/new" : undefined} action="New project" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Project</th><th>Customer</th><th>Status</th><th>Priority</th><th style={{ width: 200 }}>Health</th><th>Manager</th><th>Due</th></tr></thead>
              <tbody>
                {result.items.map((project) => (
                  <tr key={project.id}>
                    <td><Link href={`/projects/${project.id}`}><strong>{project.name}</strong></Link><div className="meta">{project.code}</div></td>
                    <td>{project.customer ? <Link href={`/customers/${project.customer.id}`}>{project.customer.name}</Link> : "—"}</td>
                    <td><Badge value={project.status} /></td>
                    <td><Badge value={project.priority} /></td>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <div className="health" data-health={project.healthStatus} style={{ flex: 1 }} title={project.healthReasons.join("; ") || "No issues"}><span style={{ width: `${project.healthScore}%` }} /></div>
                        <span className="num meta" style={{ width: 26, textAlign: "right" }}>{project.healthScore}</span>
                      </div>
                    </td>
                    <td><Person name={project.manager?.name} inactive={project.manager?.status === "inactive"} /></td>
                    <td className="nowrap" style={project.dueOn && project.dueOn < today && !["completed", "delivered", "cancelled", "archived"].includes(project.status) ? { color: "var(--color-bad)", fontWeight: 600 } : undefined}>{project.dueOn ? formatDate(project.dueOn, actor.timezone, actor.locale) : <span className="meta">—</span>}</td>
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
