import Link from "next/link";
import { Badge, PageHeader, Panel, Person, StatStrip, Tabs } from "@/components/ui";
import { listPeople, workload } from "@/lib/domain/people";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "People" };

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const actor = await requireEmployee();
  const query = await searchParams;
  const canView = actor.permissions.includes("employees.view");
  const [people, load, everyone] = await Promise.all([
    canView ? listPeople(actor, query) : Promise.resolve([]),
    workload(actor),
    canView ? listPeople(actor, {}) : Promise.resolve([]),
  ]);
  const byId = new Map(load.map((person) => [person.id, person]));
  const busiest = Math.max(1, ...load.map((person) => person.minutes));
  const status = query.status ?? "";
  const tab = (value: string) => {
    const params = new URLSearchParams();
    if (value) params.set("status", value);
    if (query.q) params.set("q", query.q);
    const text = params.toString();
    return text ? `/people?${text}` : "/people";
  };

  return (
    <main>
      <PageHeader title="People" lede="Roles are granted on the server. Disabling someone revokes their sessions and leaves their history readable." />
      <StatStrip items={[
        { label: "Employees", value: everyone.length },
        { label: "Active", value: everyone.filter((person) => person.status === "active").length },
        { label: "Inactive", value: everyone.filter((person) => person.status !== "active").length, tone: load.some((person) => person.inactive) ? "soon" : "" , hint: load.some((person) => person.inactive) ? "Some still hold open work" : undefined },
        { label: "Assigned open work", value: load.reduce((sum, person) => sum + person.tasks, 0), hint: `${Math.round(load.reduce((sum, person) => sum + person.minutes, 0) / 60)}h estimated` },
      ]} />
      <Tabs label="Employee status" items={[
        { href: tab(""), label: "Everyone", count: everyone.length, current: status === "" },
        { href: tab("active"), label: "Active", current: status === "active" },
        { href: tab("inactive"), label: "Inactive", current: status === "inactive" },
      ]} />

      <div className="record">
        <Panel flush>
          <form className="toolbar" action="/people">
            {status ? <input type="hidden" name="status" value={status} /> : null}
            <input name="q" type="search" defaultValue={query.q} placeholder="Search name or email" aria-label="Search people" />
            <button className="btn btn-secondary" type="submit">Apply</button>
            {query.q ? <Link className="btn btn-ghost" href={tab(status)}>Clear</Link> : null}
          </form>
          {people.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>{canView ? "No employees match." : "No employees are visible with your current access."}</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Email</th><th>Title</th><th>Roles</th><th className="right">Open tasks</th><th>Status</th></tr></thead>
                <tbody>
                  {people.map((person) => (
                    <tr key={person.id}>
                      <td><Person name={person.name} inactive={person.status !== "active"} /></td>
                      <td><a href={`mailto:${person.email}`}>{person.email}</a></td>
                      <td>{person.jobTitle ?? person.department?.name ?? <span className="meta">—</span>}</td>
                      <td>{person.roles.map((role) => <span key={role.role.key} className="chip" style={{ marginRight: 4 }}>{role.role.name}</span>)}</td>
                      <td className="right num">{byId.get(person.id)?.tasks ?? 0}</td>
                      <td><Badge value={person.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <aside className="record-aside">
          <Panel title="Open workload" description="Estimated hours on ready, in-progress, blocked and in-review tasks">
            {load.length === 0 ? <p className="meta" style={{ margin: 0 }}>No assigned open work.</p> : (
              <div className="bars">
                {load.map((person) => (
                  <div className="bar-row" key={person.id} style={{ gridTemplateColumns: "minmax(80px, 120px) 1fr 44px", textTransform: "none" }}>
                    <span>{person.name}</span>
                    <div className={person.inactive ? "bar accent" : "bar"}><span style={{ width: `${(person.minutes / busiest) * 100}%` }} /></div>
                    <strong>{Math.round(person.minutes / 60)}h</strong>
                  </div>
                ))}
              </div>
            )}
            {load.some((person) => person.inactive) ? <p className="alert warn" style={{ marginTop: 12 }}>Red bars belong to inactive employees. Reassign that work.</p> : null}
          </Panel>
        </aside>
      </div>
    </main>
  );
}
