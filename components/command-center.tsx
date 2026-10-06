import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { dashboardLayoutAction } from "@/app/actions";
import { Badge, Panel, StatStrip } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { dashboard } from "@/lib/domain/insights";
import { formatMoney } from "@/lib/money";

type Snapshot = Awaited<ReturnType<typeof dashboard>>;
type Ctx = { data: Snapshot; locale: string; timeZone: string };

export const WIDGET_TITLES: Record<string, string> = {
  attention: "Needs attention",
  metrics: "Key numbers",
  mine: "My work",
  health: "Project health",
  pipeline: "Lead pipeline",
  deadlines: "Deadlines",
  workload: "Team workload",
  commercial: "Commercial",
  activity: "Recent activity",
};

export function CommandCenter({ data, locale, timeZone }: Ctx) {
  const ctx = { data, locale, timeZone };
  const main: React.ReactNode[] = [];
  const side: React.ReactNode[] = [];
  for (const widget of data.widgets) {
    if (widget === "attention") main.push(<Attention key={widget} {...ctx} />);
    else if (widget === "mine") side.push(<Mine key={widget} {...ctx} />);
    else if (widget === "health") {
      main.push(<AtRisk key="at-risk" {...ctx} />);
      side.push(<PortfolioHealth key="portfolio" {...ctx} />);
    } else if (widget === "pipeline") side.push(<Pipeline key={widget} data={data} />);
    else if (widget === "deadlines") {
      main.push(<div className="dash-pair" key="deadlines"><Milestones {...ctx} /><Upcoming {...ctx} /></div>);
      side.push(<TaskMix key="task-mix" data={data} />);
    } else if (widget === "workload") side.push(<Workload key={widget} data={data} />);
    else if (widget === "commercial") side.push(<Commercial key={widget} data={data} locale={locale} />);
    else if (widget === "activity") main.push(<Activity key={widget} {...ctx} />);
  }
  return (
    <>
      {data.widgets.includes("metrics") ? <Metrics data={data} /> : null}
      <div className="dash">
        <div className="dash-col">{main}</div>
        <div className="dash-col">{side}</div>
      </div>
    </>
  );
}

export function ArrangeDashboard({ widgets }: { widgets: string[] }) {
  const order = widgets.join(",");
  return (
    <div className="form">
      <p className="help">Order is saved to your profile. Sections your role cannot access stay hidden.</p>
      <div className="rows" style={{ border: "1px solid var(--color-line)", borderRadius: 8 }}>
        {widgets.map((widget, index) => (
          <div key={widget}>
            <div className="grow"><strong>{WIDGET_TITLES[widget]}</strong></div>
            <div className="btn-group">
              {(["up", "down"] as const).map((direction) => (
                <form key={direction} action={dashboardLayoutAction}>
                  <input type="hidden" name="order" value={order} />
                  <input type="hidden" name="widget" value={widget} />
                  <button className="btn btn-secondary btn-sm" name="direction" value={direction} type="submit" disabled={direction === "up" ? index === 0 : index === widgets.length - 1} aria-label={`Move ${WIDGET_TITLES[widget]} ${direction}`}>
                    {direction === "up" ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
                  </button>
                </form>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="meta" style={{ padding: "14px 16px", margin: 0 }}>{children}</p>;
}

function Metrics({ data }: { data: Snapshot }) {
  const risky = data.counts.atRisk + data.counts.critical;
  const items: Array<{ label: string; value: number; href: string; hint?: string; tone?: "now" | "soon" | "" }> = [
    { label: "Overdue tasks", value: data.counts.overdueTasks, href: "/work?overdue=1", tone: data.counts.overdueTasks > 0 ? "now" : "" },
    { label: "Blocked tasks", value: data.counts.blocked, href: "/work?status=blocked", tone: data.counts.blocked > 0 ? "now" : "" },
    { label: "Due today", value: data.counts.dueToday, href: "/work", tone: data.counts.dueToday > 0 ? "soon" : "" },
    { label: "Projects at risk", value: risky, href: "/projects?health=at_risk", hint: data.counts.critical ? `${data.counts.critical} critical` : undefined, tone: risky > 0 ? "now" : "" },
    { label: "Pending approvals", value: data.counts.pendingApprovals, href: "/approvals", tone: data.counts.pendingApprovals > 0 ? "soon" : "" },
    { label: "Active projects", value: data.counts.activeProjects, href: "/projects?status=active", hint: data.counts.openChanges ? `${data.counts.openChanges} open changes` : undefined },
  ];
  if (data.counts.openLeads) items.push({ label: "Open leads", value: data.counts.openLeads, href: "/leads", hint: data.counts.newLeads ? `${data.counts.newLeads} new in ${data.rangeDays}d` : undefined });
  return <StatStrip items={items} />;
}

function Attention({ data, locale, timeZone }: Ctx) {
  return (
    <Panel title="Needs attention" description="Overdue, blocked, or waiting on your decision" flush footer={data.reminders[0] ? <span className="meta">Next follow-up {formatDateTime(data.reminders[0].dueAt, timeZone, locale)}</span> : undefined}>
      {data.attention.length === 0 ? <Quiet>You are clear. Nothing assigned to you is overdue, blocked or waiting on a decision.</Quiet> : (
        <div className="attention">
          {data.attention.map((item) => (
            <Link key={item.id} className={item.severity} href={item.href}>
              <span className="row"><strong>{item.title}</strong><Badge value={item.severity === "now" ? "action" : item.severity === "soon" ? "soon" : "update"} /></span>
              <span className="meta">{item.detail}</span>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Mine({ data, locale, timeZone }: Ctx) {
  return (
    <Panel title="My work" description={`${data.counts.myOpen} open tasks assigned to you`} actions={<Link className="btn btn-ghost btn-sm" href="/work?mine=1">View all</Link>} flush>
      {data.mine.length === 0 ? <Quiet>No open work is assigned to you.</Quiet> : (
        <div className="rows">
          {data.mine.map((task) => (
            <Link key={task.id} href={`/projects/${task.projectId}?tab=tasks`}>
              <div className="grow"><strong>{task.title}</strong><span className="meta">{task.project.name} · due {formatDate(task.dueOn, timeZone, locale)}</span></div>
              <Badge value={task.dueOn && task.dueOn < data.today ? "overdue" : task.status} />
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function AtRisk({ data }: Ctx) {
  return (
    <Panel title="Projects needing attention" actions={<Link className="btn btn-ghost btn-sm" href="/projects?health=at_risk">All at risk</Link>} flush>
      {data.atRisk.length === 0 ? <Quiet>No project in your scope is at risk or critical.</Quiet> : (
        <div className="rows">
          {data.atRisk.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <div className="grow"><strong>{project.name}</strong><span className="meta">{project.customer.name} · {project.healthReasons[0] ?? "Health needs review"}</span></div>
              <div className="health" data-health={project.healthStatus} style={{ width: 90 }}><span style={{ width: `${project.healthScore}%` }} /></div>
              <Badge value={project.healthStatus} />
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function PortfolioHealth({ data }: Ctx) {
  const mix = [
    ["Healthy", data.healthMix.healthy, "healthy"],
    ["Watch", data.healthMix.watch, "watch"],
    ["At risk", data.healthMix.at_risk, "at_risk"],
    ["Critical", data.healthMix.critical, "critical"],
  ] as const;
  const max = Math.max(1, ...mix.map(([, count]) => count));
  return (
    <Panel title="Portfolio health">
      <div className="bars" role="img" aria-label={mix.map(([label, count]) => `${label} ${count}`).join(", ")}>
        {mix.map(([label, count, tone]) => (
          <Link className="bar-row" key={tone} href={`/projects?health=${tone}`}>
            <span>{label}</span>
            <div className="health" data-health={tone}><span style={{ width: `${(count / max) * 100}%` }} /></div>
            <strong>{count}</strong>
          </Link>
        ))}
      </div>
      <h4 className="sub-head">Open blockers</h4>
      {data.issues.length === 0 ? <p className="meta" style={{ margin: 0 }}>No open risks or blockers.</p> : (
        <div className="stack" style={{ gap: 8 }}>
          {data.issues.map((issue) => (
            <Link key={issue.id} href={`/projects/${issue.projectId}`} className="row" style={{ textDecoration: "none" }}>
              <span style={{ minWidth: 0 }}><strong style={{ color: "var(--color-ink)", fontWeight: 580 }}>{issue.title}</strong><span className="meta" style={{ display: "block" }}>{issue.project.name}</span></span>
              <Badge value={issue.severity} />
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Pipeline({ data }: { data: Snapshot }) {
  const max = Math.max(1, ...data.pipeline.map((row) => row._count._all));
  return (
    <Panel title="Lead pipeline" description={`${data.counts.newLeads} new in the last ${data.rangeDays} days`} actions={<Link className="btn btn-ghost btn-sm" href="/leads">Open leads</Link>}>
      {data.pipeline.length === 0 ? <p className="meta" style={{ margin: 0 }}>No leads are recorded.</p> : (
        <div className="bars" role="img" aria-label={data.pipeline.map((row) => `${row.status} ${row._count._all}`).join(", ")}>
          {data.pipeline.map((row) => (
            <Link className="bar-row" key={row.status} href={`/leads?view=${row.status}`}>
              <span>{row.status.replaceAll("_", " ")}</span>
              <div className="bar accent"><span style={{ width: `${(row._count._all / max) * 100}%` }} /></div>
              <strong>{row._count._all}</strong>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Milestones({ data, locale, timeZone }: Ctx) {
  return (
    <Panel title="Upcoming milestones" flush>
      {data.milestones.length === 0 ? <Quiet>No open milestones.</Quiet> : (
        <div className="rows">
          {data.milestones.map((milestone) => (
            <Link key={milestone.id} href={`/projects/${milestone.projectId}`}>
              <div className="grow"><strong>{milestone.name}</strong><span className="meta">{milestone.project.name} · {formatDate(milestone.dueOn, timeZone, locale)}</span></div>
              {milestone.days != null && milestone.days < 0 ? <Badge value="overdue" /> : <span className="meta num">{milestone.days == null ? "" : milestone.days === 0 ? "today" : `${milestone.days}d`}</span>}
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Upcoming({ data, locale, timeZone }: Ctx) {
  return (
    <Panel title="Upcoming tasks" actions={<Link className="btn btn-ghost btn-sm" href="/work?overdue=1">Overdue</Link>} flush>
      {data.upcoming.length === 0 ? <Quiet>No dated open tasks.</Quiet> : (
        <div className="rows">
          {data.upcoming.map((task) => (
            <Link key={task.id} href={`/projects/${task.projectId}?tab=tasks`}>
              <div className="grow"><strong>{task.title}</strong><span className="meta">{task.project.name} · {formatDate(task.dueOn, timeZone, locale)}</span></div>
              <Badge value={task.priority} />
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function TaskMix({ data }: { data: Snapshot }) {
  const max = Math.max(1, ...data.taskMix.map((row) => row._count._all));
  return (
    <Panel title="Tasks by status">
      {data.taskMix.length === 0 ? <p className="meta" style={{ margin: 0 }}>No tasks yet.</p> : (
        <div className="bars" role="img" aria-label={data.taskMix.map((row) => `${row.status} ${row._count._all}`).join(", ")}>
          {data.taskMix.map((row) => (
            <div className="bar-row" key={row.status}>
              <span>{row.status.replaceAll("_", " ")}</span>
              <div className="bar"><span style={{ width: `${(row._count._all / max) * 100}%` }} /></div>
              <strong>{row._count._all}</strong>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Workload({ data }: { data: Snapshot }) {
  const max = Math.max(1, ...data.workload.map((person) => person.tasks));
  return (
    <Panel title="Team workload" description="Open tasks by assignee" actions={<Link className="btn btn-ghost btn-sm" href="/people">People</Link>}>
      {data.workload.length === 0 ? <p className="meta" style={{ margin: 0 }}>No assigned open work in your scope.</p> : (
        <div className="bars" role="img" aria-label={data.workload.map((person) => `${person.name} ${person.tasks}`).join(", ")}>
          {data.workload.map((person) => (
            <div className="bar-row" key={person.id} style={{ textTransform: "none" }}>
              <span>{person.name}{person.inactive ? " (inactive)" : ""}</span>
              <div className="bar"><span style={{ width: `${(person.tasks / max) * 100}%` }} /></div>
              <strong>{person.tasks}</strong>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Commercial({ data, locale }: { data: Snapshot; locale: string }) {
  return (
    <Panel title="Recorded project budgets" actions={<Link className="btn btn-ghost btn-sm" href="/reports">Reports</Link>}>
      {!data.commercial ? <p className="meta" style={{ margin: 0 }}>Commercial figures are hidden for your role.</p> : data.commercial.projects === 0 ? <p className="meta" style={{ margin: 0 }}>No project budgets have been recorded.</p> : (
        <>
          <div className="big-score" style={{ fontSize: 30 }}>{formatMoney(data.commercial.budgetCents, data.commercial.currency, locale)}</div>
          <p className="meta" style={{ margin: "4px 0 0" }}>Across {data.commercial.projects} projects with a budget. This is contracted budget, not recognized revenue.</p>
        </>
      )}
    </Panel>
  );
}

function Activity({ data, locale, timeZone }: Ctx) {
  return (
    <Panel title="Recent activity" description={`Last ${data.rangeDays} days`} actions={<Link className="btn btn-ghost btn-sm" href="/notifications">Notifications</Link>} flush>
      {data.activities.length === 0 ? <Quiet>No activity in this window.</Quiet> : (
        <div className="rows">
          {data.activities.map((activity) => {
            const href = activity.projectId ? `/projects/${activity.projectId}` : activity.customerId ? `/customers/${activity.customerId}` : "/dashboard";
            return (
              <Link key={activity.id} href={href}>
                <div className="grow"><strong>{activity.summary}</strong><span className="meta">{activity.actorName} · {formatDateTime(activity.createdAt, timeZone, locale)}</span></div>
              </Link>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
