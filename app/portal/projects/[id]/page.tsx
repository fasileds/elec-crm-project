import Link from "next/link";
import { CommentForm } from "@/components/project-forms";
import { listProjectSrs, versionLabel } from "@/lib/domain/srs/core";
import { Badge, PageHeader, Panel, Props } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { listComments } from "@/lib/domain/comments";
import { getProject } from "@/lib/domain/projects";
import { requireCustomer } from "@/lib/session";

export default async function PortalProject({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireCustomer();
  const { id } = await params;
  const [project, comments, srs] = await Promise.all([getProject(actor, id), listComments(actor, "project", id), listProjectSrs(actor, id)]);
  const done = project.milestones.filter((milestone) => milestone.status === "completed" || milestone.status === "done").length;

  return (
    <main>
      <PageHeader
        crumbs={[{ href: "/portal/projects", label: "Projects" }, { label: project.code }]}
        title={project.name}
        badges={<Badge value={project.status} />}
        lede={project.summary || "Your team will post progress here."}
      />
      <div className="record">
        <div className="record-main">
          <Panel title="Milestones" description={project.milestones.length ? `${done} of ${project.milestones.length} complete` : undefined} flush>
            {project.milestones.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>Milestones will appear once the plan is shared.</p> : (
              <div className="rows">
                {project.milestones.map((milestone) => (
                  <div key={milestone.id}>
                    <div className="grow"><strong>{milestone.name}</strong><span className="meta">Due {milestone.dueOn ? formatDate(milestone.dueOn, actor.timezone, actor.locale) : "to be scheduled"}</span></div>
                    <Badge value={milestone.status} />
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <div className="dash-pair">
            <Panel title="Requirements" flush>
              {project.requirements.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No shared requirements yet.</p> : (
                <div className="rows">
                  {project.requirements.map((requirement) => (
                    <div key={requirement.id}><div className="grow"><strong>{requirement.title}</strong><span className="meta">{requirement.code}</span></div><Badge value={requirement.status} /></div>
                  ))}
                </div>
              )}
            </Panel>
            <Panel title="Change requests" flush>
              {project.changes.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No open change requests.</p> : (
                <div className="rows">
                  {project.changes.map((change) => (
                    <div key={change.id}><div className="grow"><strong>{change.title}</strong><span className="meta">{change.code}</span></div><Badge value={change.status} /></div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <Panel title="Conversation" description="Visible to your project team. Internal company notes are not shown.">
            <div className="stack" style={{ marginBottom: 14 }}>
              {comments.length === 0 ? <p className="meta" style={{ margin: 0 }}>No messages yet.</p> : comments.map((comment) => (
                <article className="comment" key={comment.id}>
                  <strong>{comment.authorName}</strong>
                  <p style={{ whiteSpace: "pre-wrap" }}>{comment.deleted ? "This message was removed." : comment.body}</p>
                  <div className="meta">{formatDateTime(comment.createdAt, actor.timezone, actor.locale)}</div>
                </article>
              ))}
            </div>
            <CommentForm projectId={project.id} entityId={project.id} customer />
          </Panel>
        </div>

        <aside className="record-aside">
          <Panel title="Requirements specification" flush>
            {srs.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>The SRS will appear here when your team shares it.</p> : (
              <ul className="rows">
                {srs.map((doc) => (
                  <li key={doc.id}>
                    <div className="grow"><strong>{doc.code}</strong><span className="meta">Version {versionLabel(doc)}</span></div>
                    <Badge value={doc.status} />
                    <Link className="btn btn-secondary btn-sm" href={`/portal/projects/${project.id}/srs?doc=${doc.id}`}>Open</Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Project">
            <Props items={[
              ["Status", <Badge key="status" value={project.status} />],
              ["Project manager", project.manager?.name ?? "—"],
              ["Start", project.startOn ? formatDate(project.startOn, actor.timezone, actor.locale) : "—"],
              ["Target date", project.dueOn ? formatDate(project.dueOn, actor.timezone, actor.locale) : "—"],
            ]} />
          </Panel>
        </aside>
      </div>
    </main>
  );
}
