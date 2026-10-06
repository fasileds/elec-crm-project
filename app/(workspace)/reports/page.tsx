import Link from "next/link";
import { Download } from "lucide-react";
import { Badge, PageHeader, Panel, StatStrip } from "@/components/ui";
import { dashboard } from "@/lib/domain/insights";
import { workload } from "@/lib/domain/people";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const actor = await requireEmployee();
  const [data, load] = await Promise.all([dashboard(actor), workload(actor)]);
  const canExport = actor.permissions.includes("exports.create");
  const mix = [
    ["Healthy", data.healthMix.healthy, "healthy"],
    ["Watch", data.healthMix.watch, "watch"],
    ["At risk", data.healthMix.at_risk, "at_risk"],
    ["Critical", data.healthMix.critical, "critical"],
  ] as const;
  const healthMax = Math.max(1, ...mix.map(([, count]) => count));
  const taskMax = Math.max(1, ...data.taskMix.map((row) => row._count._all));
  const pipelineMax = Math.max(1, ...data.pipeline.map((row) => row._count._all));

  return (
    <main>
      <PageHeader
        title="Reports"
        lede="Figures cover records you can already see. Exports follow the same access rules and never include another tenant's data."
        action={canExport ? (
          <div className="btn-group">
            {[["projects", "Projects"], ["tasks", "Tasks"], ["customers", "Customers"]].map(([key, label]) => (
              <Link key={key} className="btn btn-secondary" href={`/api/exports/${key}`}><Download size={15} aria-hidden="true" />{label} CSV</Link>
            ))}
          </div>
        ) : null}
      />
      <StatStrip items={[
        { label: "Active projects", value: data.counts.activeProjects, href: "/projects?status=active" },
        { label: "At risk or critical", value: data.counts.atRisk + data.counts.critical, href: "/projects?health=at_risk", tone: data.counts.atRisk + data.counts.critical ? "now" : "" },
        { label: "Blocked tasks", value: data.counts.blocked, href: "/work?status=blocked", tone: data.counts.blocked ? "now" : "" },
        { label: "Overdue tasks", value: data.counts.overdueTasks, href: "/work?overdue=1", tone: data.counts.overdueTasks ? "now" : "" },
        { label: "Upcoming deadlines", value: data.upcoming.length },
        { label: "Open leads", value: data.counts.openLeads, href: "/leads" },
      ]} />

      <div className="dash-pair">
        <Panel title="Portfolio health" description="Open projects by calculated health">
          <div className="bars">
            {mix.map(([label, count, tone]) => (
              <Link className="bar-row" key={tone} href={`/projects?health=${tone}`}>
                <span>{label}</span>
                <div className="health" data-health={tone}><span style={{ width: `${(count / healthMax) * 100}%` }} /></div>
                <strong>{count}</strong>
              </Link>
            ))}
          </div>
        </Panel>
        <Panel title="Tasks by status">
          {data.taskMix.length === 0 ? <p className="meta" style={{ margin: 0 }}>No tasks yet.</p> : (
            <div className="bars">
              {data.taskMix.map((row) => (
                <div className="bar-row" key={row.status}>
                  <span>{row.status.replaceAll("_", " ")}</span>
                  <div className="bar"><span style={{ width: `${(row._count._all / taskMax) * 100}%` }} /></div>
                  <strong>{row._count._all}</strong>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Lead pipeline" description="Current lead stages">
          {data.pipeline.length === 0 ? <p className="meta" style={{ margin: 0 }}>No leads are recorded.</p> : (
            <div className="bars">
              {data.pipeline.map((row) => (
                <Link className="bar-row" key={row.status} href={`/leads?view=${row.status}`}>
                  <span>{row.status.replaceAll("_", " ")}</span>
                  <div className="bar accent"><span style={{ width: `${(row._count._all / pipelineMax) * 100}%` }} /></div>
                  <strong>{row._count._all}</strong>
                </Link>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Workload" description="Open tasks and estimated effort per assignee" flush>
          {load.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No assigned open work.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Person</th><th className="right">Open tasks</th><th className="right">Estimate</th><th>Status</th></tr></thead>
                <tbody>
                  {load.map((person) => (
                    <tr key={person.id}>
                      <td><strong>{person.name}</strong></td>
                      <td className="right num">{person.tasks}</td>
                      <td className="right num">{Math.round(person.minutes / 60)}h</td>
                      <td><Badge value={person.inactive ? "inactive" : "active"} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      {!canExport ? <p className="meta" style={{ marginTop: 16 }}>Exports are available to roles with export permission.</p> : null}
    </main>
  );
}
