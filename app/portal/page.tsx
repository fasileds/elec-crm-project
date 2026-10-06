import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { portalHome } from "@/lib/domain/insights";
import { requireCustomer } from "@/lib/session";

export const metadata = { title: "Your projects" };

export default async function PortalHome() {
  const actor = await requireCustomer();
  const data = await portalHome(actor);
  return (
    <main>
      <PageHeader kicker={data.customer?.name ?? "Portal"} title={`Hello, ${actor.name.split(" ")[0]}`} lede="Your projects, shared documents, and the decisions waiting on you. Internal company notes are not shown here." />
      <section className="grid metrics">
        <Link className={`card metric ${data.waiting ? "soon" : ""}`} href="/portal/approvals"><span>Waiting on you</span><strong>{data.waiting}</strong><em>Open</em></Link>
        <Link className="card metric" href="/portal/projects"><span>Open projects</span><strong>{data.projects.length}</strong><em>Open</em></Link>
        <Link className="card metric" href="/portal/documents"><span>Shared documents</span><strong>{data.documents.length}</strong><em>Open</em></Link>
        <article className="card metric"><span>Upcoming milestones</span><strong>{data.milestones.length}</strong></article>
      </section>
      <section className="grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="section-head"><h2>Projects</h2><Link href="/portal/projects">All projects</Link></div>
          {data.projects.length === 0 ? <p className="lede">No active projects yet. Your team will publish progress here.</p> : data.projects.map((project) => (
            <Link className="item" key={project.id} href={`/portal/projects/${project.id}`}>
              <div className="row"><strong>{project.name}</strong><Badge value={project.status} /></div>
              <div className="meta">{project.code} · due {formatDate(project.dueOn, actor.timezone, actor.locale)}</div>
              <div className="health" style={{ marginTop: 8 }}><span style={{ width: project.milestoneTotal ? `${Math.round((project.milestoneDone / project.milestoneTotal) * 100)}%` : "0%" }} /></div>
              <div className="meta">{project.milestoneDone} of {project.milestoneTotal} shared milestones complete</div>
            </Link>
          ))}
        </article>
        <div className="stack">
          <article className="card">
            <div className="section-head"><h2>Needs your decision</h2><Link href="/portal/approvals">Approvals</Link></div>
            {data.approvals.length === 0 ? <p className="lede">Nothing is waiting for your approval.</p> : data.approvals.map((approval) => (
              <Link className="item" key={approval.id} href={approval.projectId ? `/portal/projects/${approval.projectId}` : "/portal/approvals"}>
                <strong>{approval.entityType.replaceAll("_", " ")}</strong>
                <div className="meta">{approval.project ? `${approval.project.code} · ${approval.project.name}` : "Open the approval"}</div>
              </Link>
            ))}
          </article>
          <article className="card">
            <h2>Coming up</h2>
            {data.milestones.length === 0 ? <p className="lede">No shared milestones are still open.</p> : data.milestones.map((milestone) => (
              <Link className="item" key={milestone.id} href={`/portal/projects/${milestone.projectId}`}>
                <div className="row"><strong>{milestone.name}</strong><Badge value={milestone.overdue ? "overdue" : milestone.status} /></div>
                <div className="meta">{milestone.project.name} · due {formatDate(milestone.dueOn, actor.timezone, actor.locale)}</div>
              </Link>
            ))}
          </article>
        </div>
      </section>
      <section className="grid two" style={{ marginTop: 16 }}>
        <article className="card">
          <h2>Updates you can see</h2>
          {data.announcements.map((item) => <div className="item" key={item.id}><strong>{item.title}</strong><p>{item.body}</p></div>)}
          {data.activities.length === 0 ? <p className="lede">No customer-visible updates yet.</p> : (
            <ol className="timeline">
              {data.activities.map((activity) => (
                <li key={activity.id}>
                  <span className="dot" />
                  <div>
                    {activity.projectId ? <Link href={`/portal/projects/${activity.projectId}`}><strong>{activity.summary}</strong></Link> : <strong>{activity.summary}</strong>}
                    <div className="meta">{activity.actorName} · {formatDateTime(activity.createdAt, actor.timezone, actor.locale)}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </article>
        <article className="card">
          <div className="section-head"><h2>Shared documents</h2><Link href="/portal/documents">Documents</Link></div>
          {data.documents.length === 0 ? <p className="lede">Documents appear here when your team shares them.</p> : data.documents.map((document) => (
            <div className="item" key={document.id}><strong>{document.fileName}</strong><div className="meta">{formatDate(document.createdAt, actor.timezone, actor.locale)}</div></div>
          ))}
          {data.tasks.length ? <h2 style={{ marginTop: 16 }}>Work shared with you</h2> : null}
          {data.tasks.map((task) => (
            <Link className="item" key={task.id} href={`/portal/projects/${task.projectId}`}>
              <div className="row"><strong>{task.title}</strong><Badge value={task.status} /></div>
              <div className="meta">{task.project.name} · due {formatDate(task.dueOn, actor.timezone, actor.locale)}</div>
            </Link>
          ))}
        </article>
      </section>
    </main>
  );
}
