import Link from "next/link";
import { Plus } from "lucide-react";
import { baselineAction, milestoneAction, onboardingAction, projectStatusAction } from "@/app/actions";
import { CommentForm, RequirementForm, TaskForm } from "@/components/project-forms";
import { Badge, Drawer, PageHeader, Panel, Person, Props, Tabs } from "@/components/ui";
import { can } from "@/lib/actor";
import { formatDate, formatDateTime } from "@/lib/dates";
import { listComments } from "@/lib/domain/comments";
import { getProject } from "@/lib/domain/projects";
import { formatMoney } from "@/lib/money";
import { requireEmployee } from "@/lib/session";

const STATUSES = ["draft", "proposed", "approved", "onboarding", "planning", "active", "on_hold", "blocked", "completed", "delivered", "cancelled", "archived"];
const TABS = ["overview", "requirements", "tasks", "changes", "discussion", "activity"] as const;

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; error?: string; notice?: string }> }) {
  const actor = await requireEmployee();
  const { id } = await params;
  const { tab: rawTab, error, notice } = await searchParams;
  const tab = rawTab === "work" ? "tasks" : TABS.find((item) => item === rawTab) ?? "overview";
  const [project, comments] = await Promise.all([getProject(actor, id), listComments(actor, "project", id)]);
  const editable = !project.archivedAt && can(actor, "projects.edit");
  const openTasks = project.tasks.filter((task) => !["done", "cancelled"].includes(task.status));
  const doneOnboarding = project.onboarding.filter((item) => item.done).length;
  const today = new Date().toISOString().slice(0, 10);
  const tabHref = (item: string) => item === "overview" ? `/projects/${project.id}` : `/projects/${project.id}?tab=${item}`;

  return (
    <main>
      <PageHeader
        crumbs={[{ href: "/projects", label: "Projects" }, { label: project.code }]}
        title={project.name}
        badges={<><Badge value={project.status} /><Badge value={project.healthStatus} />{project.archivedAt ? <Badge value="archived" /> : null}</>}
        facts={
          <>
            {project.customer ? <span><Link href={`/customers/${project.customer.id}`}><strong>{project.customer.name}</strong></Link></span> : null}
            <span>Manager <strong>{project.manager?.name ?? "unassigned"}</strong></span>
            <span>{project.startOn ? formatDate(project.startOn, actor.timezone, actor.locale) : "No start"} → {project.dueOn ? formatDate(project.dueOn, actor.timezone, actor.locale) : "no due date"}</span>
          </>
        }
        action={editable ? (
          <>
            {can(actor, "projects.transition") ? (
              <Drawer label="Change status" title="Change project status">
                <form action={projectStatusAction} className="form">
                  <input type="hidden" name="id" value={project.id} />
                  <input type="hidden" name="version" value={project.version} />
                  <label>Move to<select name="status" defaultValue={project.status}>{STATUSES.map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}</select></label>
                  <label>Override reason<input name="overrideReason" placeholder="Required only when rules block the move" /></label>
                  <p className="help">Moves are checked against onboarding, scope and approval rules. Every change is recorded in the activity log.</p>
                  <div className="form-actions"><button className="btn btn-primary" type="submit">Update status</button></div>
                </form>
              </Drawer>
            ) : null}
            <Drawer label="Add task" title="New task" primary icon={<Plus size={15} aria-hidden="true" />}><TaskForm projectId={project.id} /></Drawer>
          </>
        ) : null}
      />

      {error ? <p className="alert bad" role="alert" style={{ marginBottom: 16 }}>{error}</p> : null}
      {notice ? <p className="alert ok" role="status" style={{ marginBottom: 16 }}>{notice}</p> : null}
      {project.archivedAt ? <p className="alert warn" style={{ marginBottom: 16 }}>This project is archived and read-only except for an authorized restore.</p> : null}

      <Tabs label="Project sections" items={[
        { href: tabHref("overview"), label: "Overview", current: tab === "overview" },
        ...(can(actor, "srs.view") ? [{ href: `/projects/${project.id}/srs`, label: "SRS" }] : []),
        { href: tabHref("requirements"), label: "Requirements", count: project.requirements.length, current: tab === "requirements" },
        { href: tabHref("tasks"), label: "Tasks", count: openTasks.length, current: tab === "tasks" },
        { href: tabHref("changes"), label: "Change requests", count: project.changes.length, current: tab === "changes", alert: project.changes.some((change) => change.status === "submitted" || change.status === "pending") },
        { href: tabHref("discussion"), label: "Discussion", count: comments.length, current: tab === "discussion" },
        { href: tabHref("activity"), label: "Activity", current: tab === "activity" },
      ]} />

      <div className="record">
        <div className="record-main">
          {tab === "overview" ? (
            <>
              {project.summary || project.objectives ? (
                <Panel title="Brief">
                  {project.summary ? <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{project.summary}</p> : null}
                  {project.objectives ? <><h4 className="sub-head">Objectives</h4><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{project.objectives}</p></> : null}
                </Panel>
              ) : null}

              <Panel title="Milestones" flush footer={editable ? (
                <form action={milestoneAction} className="inline-form">
                  <input type="hidden" name="projectId" value={project.id} />
                  <input name="name" placeholder="New milestone" aria-label="Milestone name" required />
                  <input name="dueOn" type="date" aria-label="Milestone due date" />
                  <button className="btn btn-secondary btn-sm" type="submit">Add milestone</button>
                </form>
              ) : undefined}>
                {project.milestones.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No milestones planned yet.</p> : (
                  <div className="rows">
                    {project.milestones.map((milestone) => (
                      <div key={milestone.id}>
                        <div className="grow"><strong>{milestone.name}</strong><span className="meta" style={milestone.dueOn && milestone.dueOn < today && milestone.status !== "done" ? { color: "var(--color-bad)" } : undefined}>Due {milestone.dueOn ? formatDate(milestone.dueOn, actor.timezone, actor.locale) : "unscheduled"}</span></div>
                        <Badge value={milestone.status} />
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Onboarding" description={project.onboarding.length ? `${doneOnboarding} of ${project.onboarding.length} complete` : undefined} flush>
                {project.onboarding.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No onboarding checklist for this project.</p> : null}
                <div className="rows">
                  {project.onboarding.map((item) => (
                    <form key={item.id} action={onboardingAction}>
                      <input type="hidden" name="projectId" value={project.id} />
                      <input type="hidden" name="templateKey" value={item.templateKey} />
                      <div className="grow">
                        <strong style={item.done ? { color: "var(--color-faint)", textDecoration: "line-through" } : undefined}>{item.label}</strong>
                        {item.templateKey === "approve_scope" && !item.done ? <span className="meta">Can be completed once the client approves the <Link href={`/projects/${project.id}/srs?tab=approval`}>SRS</Link> or approved requirements are baselined.</span> : null}
                      </div>
                      {item.done ? <Badge value="done" /> : item.required ? <Badge value="required" /> : null}
                      {!item.done && editable ? <button className="btn btn-secondary btn-sm" type="submit">Mark complete</button> : null}
                    </form>
                  ))}
                </div>
              </Panel>

              {project.meetings.length ? (
                <Panel title="Meetings" flush>
                  <div className="rows">
                    {project.meetings.map((meeting) => (
                      <div key={meeting.id}>
                        <div className="grow"><strong>{meeting.title}</strong><span className="meta">{formatDateTime(meeting.startsAt, actor.timezone, actor.locale)}{meeting.agenda ? ` · ${meeting.agenda}` : ""}</span></div>
                        <Badge value={meeting.visibility} />
                      </div>
                    ))}
                  </div>
                </Panel>
              ) : null}
            </>
          ) : null}

          {tab === "requirements" ? (
            <Panel
              title="Requirements"
              description={project.scopeBaselinedAt ? `Scope baselined ${formatDate(project.scopeBaselinedAt, actor.timezone, actor.locale)}` : "Scope is not baselined yet"}
              actions={editable ? (
                <>
                  {!project.scopeBaselinedAt ? <form action={baselineAction}><input type="hidden" name="projectId" value={project.id} /><button className="btn btn-secondary btn-sm" type="submit">Baseline approved scope</button></form> : null}
                  <Drawer label="Add requirement" title="New requirement" icon={<Plus size={14} aria-hidden="true" />}><RequirementForm projectId={project.id} /></Drawer>
                </>
              ) : null}
              flush
            >
              {project.requirements.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No requirements captured yet.</p> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Code</th><th>Requirement</th><th>Acceptance criteria</th><th>Status</th></tr></thead>
                    <tbody>
                      {project.requirements.map((requirement) => (
                        <tr key={requirement.id}>
                          <td className="nowrap meta">{requirement.code}</td>
                          <td><strong>{requirement.title}</strong>{requirement.description ? <div className="meta clamp">{requirement.description}</div> : null}</td>
                          <td className="meta">{requirement.acceptance || "Not written yet"}</td>
                          <td><Badge value={requirement.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          ) : null}

          {tab === "tasks" ? (
            <Panel title="Tasks" description={`${openTasks.length} open · ${project.tasks.length - openTasks.length} closed`} flush actions={<Link className="btn btn-ghost btn-sm" href="/work">Open task board</Link>}>
              {project.tasks.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No tasks yet. Use Add task to plan the work.</p> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Code</th><th>Task</th><th>Status</th><th>Priority</th><th>Due</th><th>Visibility</th></tr></thead>
                    <tbody>
                      {project.tasks.map((task) => (
                        <tr key={task.id}>
                          <td className="nowrap meta">{task.code}</td>
                          <td><strong>{task.title}</strong></td>
                          <td><Badge value={task.status} /></td>
                          <td><Badge value={task.priority} /></td>
                          <td className="nowrap" style={task.dueOn && task.dueOn < today && !["done", "cancelled"].includes(task.status) ? { color: "var(--color-bad)", fontWeight: 600 } : undefined}>{task.dueOn ? formatDate(task.dueOn, actor.timezone, actor.locale) : <span className="meta">—</span>}</td>
                          <td className="meta">{task.customerVisible ? "Customer" : "Internal"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          ) : null}

          {tab === "changes" ? (
            <Panel title="Change requests" description="New requirements after the scope baseline arrive here instead of rewriting the original scope." flush>
              {project.changes.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No change requests.</p> : (
                <div className="rows">
                  {project.changes.map((change) => (
                    <div key={change.id}>
                      <div className="grow"><strong>{change.code} · {change.title}</strong><span className="meta">{change.reason}{change.scopeImpact ? ` · Impact: ${change.scopeImpact}` : ""}</span></div>
                      <Badge value={change.status} />
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          ) : null}

          {tab === "discussion" ? (
            <Panel title="Discussion" description="Internal comments stay with your team. Shared comments are visible in the customer portal.">
              <CommentForm projectId={project.id} entityId={project.id} />
              <div className="stack" style={{ marginTop: 16 }}>
                {comments.length === 0 ? <p className="meta">No comments yet.</p> : comments.map((comment) => (
                  <article key={comment.id} className={comment.visibility === "internal" ? "comment internal" : "comment"}>
                    <div className="row"><strong>{comment.authorName}</strong><Badge value={comment.visibility} /></div>
                    <p style={{ whiteSpace: "pre-wrap" }}>{comment.deleted ? "This comment was removed. The audit history is retained." : comment.body}</p>
                    <div className="meta">{formatDateTime(comment.createdAt, actor.timezone, actor.locale)}{comment.revisionCount ? ` · ${comment.revisionCount} edit record` : ""}</div>
                  </article>
                ))}
              </div>
            </Panel>
          ) : null}

          {tab === "activity" ? (
            <Panel title="Activity log">
              <ol className="timeline">
                {project.activities.length === 0 ? <li><span className="dot" /><span className="meta">No activity yet.</span></li> : project.activities.map((activity) => (
                  <li key={activity.id}><span className="dot" /><div><strong>{activity.summary}</strong><div className="meta">{activity.actorName} · {formatDateTime(activity.createdAt, actor.timezone, actor.locale)}{activity.visibility === "customer" ? " · visible to customer" : ""}</div></div></li>
                ))}
              </ol>
            </Panel>
          ) : null}
        </div>

        <aside className="record-aside">
          <Panel title="Health">
            <div className="row" style={{ alignItems: "baseline", justifyContent: "flex-start", gap: 8 }}>
              <span className="big-score">{project.healthScore}</span><span className="meta">/ 100</span>
            </div>
            <div className="health" data-health={project.healthStatus} style={{ margin: "8px 0 12px" }}><span style={{ width: `${project.healthScore}%` }} /></div>
            {project.healthReasons.length ? <ul className="reasons risk">{project.healthReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p className="meta" style={{ margin: 0 }}>No risks detected.</p>}
          </Panel>

          <Panel title="Details">
            <Props items={[
              ["Customer", project.customer ? <Link key="customer" href={`/customers/${project.customer.id}`}>{project.customer.name}</Link> : "—"],
              ["Manager", <Person key="manager" name={project.manager?.name} inactive={project.manager?.status === "inactive"} />],
              ["Priority", <Badge key="priority" value={project.priority} />],
              ["Start", project.startOn ? formatDate(project.startOn, actor.timezone, actor.locale) : "—"],
              ["Due", project.dueOn ? formatDate(project.dueOn, actor.timezone, actor.locale) : "—"],
              ["Budget", project.budgetCents != null ? formatMoney(project.budgetCents, project.currency, actor.locale) : "—"],
              ["Scope", project.scopeBaselinedAt ? "Baselined" : "Open"],
            ]} />
            {project.manager?.status === "inactive" ? <p className="alert warn" style={{ marginTop: 12 }}>The project manager is inactive and should be replaced.</p> : null}
          </Panel>

          <Panel title="Team" description={`${project.members.length} members`} flush>
            {project.members.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No team members yet.</p> : (
              <div className="rows">
                {project.members.map((member) => (
                  <div key={member.id}>
                    <div className="grow"><Person name={member.user.name} inactive={member.user.status !== "active"} /></div>
                    <span className="meta" style={{ textTransform: "capitalize" }}>{member.role.replace("_", " ")}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </aside>
      </div>
    </main>
  );
}
