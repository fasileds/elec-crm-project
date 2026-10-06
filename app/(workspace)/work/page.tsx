import Link from "next/link";
import { taskStatusAction } from "@/app/actions";
import { Badge, Empty, PageHeader, Pager, Panel, Person, Tabs } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { listTasks } from "@/lib/domain/tasks";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "Tasks" };

const STATUSES = ["backlog", "ready", "in_progress", "blocked", "in_review", "done", "cancelled"];

type Query = { q?: string; status?: string; overdue?: string; mine?: string; page?: string };

export default async function WorkPage({ searchParams }: { searchParams: Promise<Query> }) {
  const actor = await requireEmployee();
  const query = await searchParams;
  const canAssign = actor.permissions.includes("tasks.assign");
  const mine = query.mine === "1" || !canAssign;
  const result = await listTasks(actor, { q: query.q, status: query.status, overdue: query.overdue === "1", assigneeId: mine ? actor.userId : undefined, page: Number(query.page ?? 1) });
  const href = (next: Partial<Query>) => {
    const merged = { ...query, ...next };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    const text = params.toString();
    return text ? `/work?${text}` : "/work";
  };
  const reset = { status: undefined, overdue: undefined, mine: undefined, page: undefined };
  const current = (key: string) => {
    if (key === "all") return !query.status && query.overdue !== "1" && query.mine !== "1";
    if (key === "mine") return query.mine === "1" && !query.status && query.overdue !== "1";
    if (key === "overdue") return query.overdue === "1";
    return query.status === key && query.overdue !== "1";
  };

  return (
    <main>
      <PageHeader
        title="Tasks"
        lede="Completing a task is refused while required child work or predecessors are still open, unless you record an authorized override."
        action={<Link className="btn btn-secondary" href="/projects">Add work from a project</Link>}
      />
      <Tabs label="Task views" items={[
        ...(canAssign ? [{ href: href({ ...reset }), label: "All open", current: current("all") }] : []),
        { href: href({ ...reset, mine: "1" }), label: "Assigned to me", current: canAssign ? current("mine") : current("all") },
        { href: href({ ...reset, overdue: "1" }), label: "Overdue", current: current("overdue"), alert: true },
        { href: href({ ...reset, status: "blocked" }), label: "Blocked", current: current("blocked") },
        { href: href({ ...reset, status: "in_review" }), label: "In review", current: current("in_review") },
        { href: href({ ...reset, status: "done" }), label: "Done", current: current("done") },
      ]} />

      <Panel flush footer={<Pager page={result.page} pageSize={result.pageSize} total={result.total} href={(page) => href({ page: String(page) })} />}>
        <form className="toolbar" action="/work">
          {query.mine === "1" ? <input type="hidden" name="mine" value="1" /> : null}
          <input name="q" type="search" defaultValue={query.q} placeholder="Search tasks" aria-label="Search tasks" />
          <select name="status" defaultValue={query.status ?? ""} aria-label="Task status"><option value="">Any status</option>{STATUSES.map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}</select>
          <label className="check"><input type="checkbox" name="overdue" value="1" defaultChecked={query.overdue === "1"} /> Overdue only</label>
          <button className="btn btn-secondary" type="submit">Apply</button>
        </form>
        {result.items.length === 0 ? <Empty title="No tasks in this view" body="Tasks appear when a project assigns work to you or your team." /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Task</th><th>Project</th><th>Priority</th><th>Assignee</th><th>Due</th><th>Status</th><th style={{ width: 360 }}>Update</th></tr></thead>
              <tbody>
                {result.items.map((task) => (
                  <tr key={task.id}>
                    <td><strong>{task.title}</strong><div className="meta">{task.code}{task.blockedReason ? ` · ${task.blockedReason}` : ""}</div></td>
                    <td><Link href={`/projects/${task.projectId}?tab=tasks`}>{task.project.name}</Link></td>
                    <td><Badge value={task.priority} /></td>
                    <td><Person name={task.assignee?.name} inactive={task.assignee?.inactive} /></td>
                    <td className="nowrap" style={task.overdue ? { color: "var(--color-bad)", fontWeight: 600 } : undefined}>{task.dueOn ? formatDate(task.dueOn, actor.timezone, actor.locale) : <span className="meta">—</span>}</td>
                    <td><Badge value={task.overdue ? "overdue" : task.status} /></td>
                    <td>
                      <form action={taskStatusAction} className="inline-form" style={{ flexWrap: "nowrap" }}>
                        <input type="hidden" name="id" value={task.id} />
                        <input type="hidden" name="projectId" value={task.projectId} />
                        <input type="hidden" name="version" value={task.version} />
                        <select name="status" defaultValue={task.status} aria-label={`Status for ${task.title}`} style={{ minHeight: 30, width: 128 }}>{STATUSES.map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}</select>
                        <input name="overrideReason" placeholder="Override reason" aria-label="Override reason if dependencies remain" style={{ minHeight: 30 }} />
                        <button className="btn btn-secondary btn-sm" type="submit">Save</button>
                      </form>
                    </td>
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
