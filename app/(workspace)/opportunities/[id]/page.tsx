import Link from "next/link";
import { archiveOpportunityAction, completeActivityAction, opportunityStageAction } from "@/app/actions";
import { startProjectAction } from "@/app/srs-actions";
import { CrmNoteForm } from "@/components/crm-note";
import { Idempotency } from "@/components/form";
import { Badge, Drawer, PageHeader, Panel, Person, Props } from "@/components/ui";
import { can } from "@/lib/actor";
import { prisma } from "@/lib/db";
import { PROJECT_TYPES } from "@/lib/domain/srs/catalog";
import { OPPORTUNITY_TRANSITIONS } from "@/lib/domain/workflow";
import { formatDate, formatDateTime } from "@/lib/dates";
import { listComments } from "@/lib/domain/comments";
import { getOpportunity } from "@/lib/domain/leads";
import { formatMoney } from "@/lib/money";
import { requireEmployee } from "@/lib/session";

const STAGES = ["qualification", "discovery", "requirements", "proposal", "negotiation", "verbal", "won", "lost"];

export default async function OpportunityDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const actor = await requireEmployee();
  const [{ id }, { error, notice }] = await Promise.all([params, searchParams]);
  const deal = await getOpportunity(actor, id);
  const project = await prisma.project.findFirst({ where: { opportunityId: deal.id, organizationId: actor.organizationId }, select: { id: true, code: true } });
  const notes = can(actor, "comments.create") ? await listComments(actor, "opportunity", id) : [];
  const editable = can(actor, "opportunities.edit") && !deal.archivedAt;
  const reached = STAGES.indexOf(deal.stage);
  const nextStages = OPPORTUNITY_TRANSITIONS[deal.stage] ?? [];
  const overrideStages = STAGES.filter((stage) => stage !== deal.stage && !nextStages.includes(stage));

  return (
    <main>
      <PageHeader
        crumbs={[{ href: "/opportunities", label: "Opportunities" }, { label: deal.code }]}
        title={deal.name}
        badges={<><Badge value={deal.stage} />{deal.archivedAt ? <Badge value="archived" /> : null}</>}
        facts={
          <>
            <span><Link href={`/customers/${deal.customer.id}`}><strong>{deal.customer.name}</strong></Link></span>
            <span><strong className="num">{formatMoney(deal.valueCents, deal.currency, actor.locale)}</strong> at {deal.probability}%</span>
            <span>Close {deal.expectedCloseOn ? formatDate(deal.expectedCloseOn, actor.timezone, actor.locale) : "not set"}</span>
          </>
        }
        action={
          <>
            {project ? <Link className="btn btn-secondary" href={`/projects/${project.id}/srs`}>Project {project.code} · SRS</Link> : null}
            {!project && can(actor, "projects.create") && !deal.archivedAt && deal.stage !== "lost" ? (
              <Drawer label="Start project" title="Start a project from this deal" primary>
                <form action={startProjectAction} className="form">
                  <input type="hidden" name="opportunityId" value={deal.id} />
                  <Idempotency />
                  <label>Project name<input name="name" defaultValue={deal.name} required /></label>
                  <label>Project type<select name="projectType" defaultValue="custom">{PROJECT_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                  <label>Target date<input name="dueOn" type="date" /></label>
                  <p className="help">Creates the project once for this deal and opens a draft SRS prefilled from the customer, contacts and deal notes. Starting again opens the existing project. Marking the deal won starts it automatically.</p>
                  <div className="form-actions"><button className="btn btn-primary" type="submit">Start project</button></div>
                </form>
              </Drawer>
            ) : null}
            {can(actor, "opportunities.edit") ? (
              <form action={archiveOpportunityAction}>
                <input type="hidden" name="id" value={deal.id} />
                <input type="hidden" name="restore" value={deal.archivedAt ? "1" : "0"} />
                <button className="btn btn-secondary" type="submit">{deal.archivedAt ? "Restore" : "Archive"}</button>
              </form>
            ) : null}
          </>
        }
      />
      {error ? <p className="alert bad" role="alert" style={{ marginBottom: 16 }}>{error}</p> : null}
      {notice ? <p className="alert ok" role="status" style={{ marginBottom: 16 }}>{notice}{deal.stage === "won" && !project ? " Use Start project to open the project and its SRS." : ""}</p> : null}

      {deal.archivedAt ? <p className="alert warn" style={{ marginBottom: 16 }}>Archived {formatDateTime(deal.archivedAt, actor.timezone, actor.locale)}. It is excluded from the pipeline and forecast but kept with its full history.</p> : null}

      <nav className="stage-track" aria-label="Pipeline stage">
        {STAGES.filter((stage) => stage !== "lost" || deal.stage === "lost").map((stage, index) => (
          <span key={stage} data-state={stage === deal.stage ? "current" : index < reached && deal.stage !== "lost" ? "done" : "todo"}>{stage}</span>
        ))}
      </nav>

      <div className="record">
        <div className="record-main">
          {editable && (nextStages.length || can(actor, "leads.assign")) ? (
            <Panel title="Move stage" description="Skipping a stage requires a reason and an authorized override. Every move is recorded.">
              <form action={opportunityStageAction} className="form">
                <input type="hidden" name="id" value={deal.id} />
                <div className="form-row">
                  <label>Next stage
                    <select name="stage" defaultValue={nextStages[0]}>
                      <optgroup label="Allowed next">{nextStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</optgroup>
                      {can(actor, "leads.assign") && overrideStages.length ? <optgroup label="Needs an override">{overrideStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</optgroup> : null}
                    </select>
                  </label>
                  <label>Reason<input name="reason" placeholder="Required for lost or an override" /></label>
                </div>
                <div className="row">
                  {can(actor, "leads.assign") ? <label className="check"><input type="checkbox" name="override" value="1" /> Record an authorized override</label> : <span />}
                  <button className="btn btn-primary" type="submit">Save stage</button>
                </div>
              </form>
            </Panel>
          ) : null}

          <Panel title="Stage history" flush>
            <div className="rows">
              {deal.events.map((event) => (
                <div key={event.id}>
                  <div className="grow">
                    <strong>{event.fromStage ? `${event.fromStage} → ${event.toStage}` : `Opened in ${event.toStage}`}</strong>
                    <span className="meta">{event.actorName} · {formatDateTime(event.createdAt, actor.timezone, actor.locale)}{event.reason ? ` · “${event.reason}”` : ""}</span>
                  </div>
                  {event.override ? <Badge value="override" /> : null}
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Activities" flush>
            {deal.activities.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No activities on this deal yet.</p> : (
              <div className="rows">
                {deal.activities.map((activity) => (
                  <form key={activity.id} action={completeActivityAction}>
                    <input type="hidden" name="id" value={activity.id} />
                    <div className="grow"><strong>{activity.subject}</strong><span className="meta">{activity.type.replace("_", " ")} · {activity.owner.name}{activity.dueAt ? ` · ${formatDateTime(activity.dueAt, actor.timezone, actor.locale)}` : ""}</span></div>
                    <Badge value={activity.status} />
                    {activity.status === "open" && can(actor, "leads.edit") ? <button className="btn btn-secondary btn-sm" type="submit">Complete</button> : null}
                  </form>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Internal notes" description="Visible to your company only">
            {can(actor, "comments.create") ? <CrmNoteForm entityType="opportunity" entityId={deal.id} /> : null}
            <ol className="timeline" style={{ marginTop: 14 }}>
              {notes.length === 0 ? <li><span className="dot" /><span className="meta">No notes yet.</span></li> : notes.map((note) => (
                <li key={note.id}><span className="dot" /><div><strong>{note.authorName}</strong><p style={{ marginTop: 2, whiteSpace: "pre-wrap" }}>{note.deleted ? "Removed" : note.body}</p><div className="meta">{formatDateTime(note.createdAt, actor.timezone, actor.locale)}</div></div></li>
              ))}
            </ol>
          </Panel>
        </div>

        <aside className="record-aside">
          <Panel title="Deal">
            <Props items={[
              ["Owner", <Person key="owner" name={deal.owner?.name} inactive={deal.owner?.status === "inactive"} />],
              ["Customer", <Link key="customer" href={`/customers/${deal.customer.id}`}>{deal.customer.code} · {deal.customer.name}</Link>],
              ["Primary contact", deal.contact ? `${deal.contact.name}${deal.contact.email ? ` · ${deal.contact.email}` : ""}` : "—"],
              ["Value", formatMoney(deal.valueCents, deal.currency, actor.locale)],
              ["Weighted", formatMoney(Math.round(deal.valueCents * deal.probability / 100), deal.currency, actor.locale)],
              ["Source", deal.source ?? "—"],
              ["Origin lead", deal.lead ? <Link key="lead" href={`/leads/${deal.lead.id}`}>{deal.lead.code} · {deal.lead.name}</Link> : "—"],
              ["Created", formatDate(deal.createdAt, actor.timezone, actor.locale)],
              ["Closed", deal.closedAt ? formatDate(deal.closedAt, actor.timezone, actor.locale) : "—"],
            ]} />
            {deal.lostReason ? <p className="alert" style={{ marginTop: 12 }}>Lost: {deal.lostReason}</p> : null}
          </Panel>
        </aside>
      </div>
    </main>
  );
}
