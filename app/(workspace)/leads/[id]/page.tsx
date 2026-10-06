import Link from "next/link";
import { ArrowRightLeft, CalendarPlus, Mail, MapPin, Phone } from "lucide-react";
import { assignLeadAction, completeActivityAction, convertLeadAction, crmActivityAction, leadStatusAction, mergeLeadAction, qualifyLeadAction } from "@/app/actions";
import { CrmNoteForm } from "@/components/crm-note";
import { Idempotency } from "@/components/form";
import { Badge, Drawer, Empty, PageHeader, Panel, Person, Props, Tabs } from "@/components/ui";
import { can } from "@/lib/actor";
import { formatDate, formatDateTime } from "@/lib/dates";
import { listComments } from "@/lib/domain/comments";
import { LEAD_TRANSITIONS } from "@/lib/domain/workflow";
import { getLead, leadWorkload, listAssignableEmployees, previewConversion } from "@/lib/domain/leads";
import { formatMoney } from "@/lib/money";
import { requireEmployee } from "@/lib/session";

const ACTIVITY_TYPES = [["follow_up", "Follow-up"], ["call", "Call"], ["email", "Email"], ["meeting", "Meeting"], ["demo", "Demo"], ["proposal", "Proposal"], ["visit", "Visit"], ["task", "Task"], ["note", "Note"]] as const;
const QUALIFICATION = [["budget", "Budget"], ["authority", "Decision maker"], ["need", "Need"], ["timeline", "Timeline"], ["competitors", "Competitors"], ["objections", "Objections"]] as const;

export default async function LeadDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; error?: string; notice?: string }> }) {
  const actor = await requireEmployee();
  const { id } = await params;
  const { tab = "overview", error, notice } = await searchParams;
  const lead = await getLead(actor, id);
  const manager = can(actor, "leads.assign");
  const [people, workload, preview, notes] = await Promise.all([
    manager ? listAssignableEmployees(actor) : Promise.resolve([]),
    manager ? leadWorkload(actor) : Promise.resolve(new Map<string, { open: number; overdue: number }>()),
    can(actor, "leads.convert") ? previewConversion(actor, id) : Promise.resolve(null),
    can(actor, "comments.create") ? listComments(actor, "lead", id) : Promise.resolve([]),
  ]);
  const qualification = lead.qualification as Record<string, string>;
  const open = lead.activities.filter((activity) => activity.status === "open");
  const done = lead.activities.filter((activity) => activity.status !== "open");
  const now = new Date().getTime();
  const editable = can(actor, "leads.edit") && lead.status !== "converted" && !lead.archivedAt;
  const base = `/leads/${lead.id}`;
  const nextStages = LEAD_TRANSITIONS[lead.status] ?? [];

  return (
    <main>
      {error ? <p className="alert" role="alert" style={{ marginBottom: 12 }}>{error}</p> : null}
      {notice ? <p className="alert ok" role="status" style={{ marginBottom: 12 }}>{notice}</p> : null}
      <PageHeader
        crumbs={[{ href: "/leads", label: "Leads" }, { label: lead.code }]}
        title={lead.name}
        badges={<><Badge value={lead.status} />{lead.priority === "high" || lead.priority === "critical" ? <Badge value={`${lead.priority} priority`} /> : null}{lead.ownershipStatus === "unassigned" ? <Badge value="unassigned" /> : null}</>}
        facts={
          <>
            <span><strong>{lead.company || "Individual"}</strong>{lead.industry ? ` · ${lead.industry}` : ""}</span>
            {lead.email ? <span><Mail size={13} aria-hidden="true" /><a href={`mailto:${lead.email}`}>{lead.email}</a></span> : null}
            {lead.phone ? <span><Phone size={13} aria-hidden="true" />{lead.phone}</span> : null}
            {lead.location ? <span><MapPin size={13} aria-hidden="true" />{lead.location}</span> : null}
          </>
        }
        action={
          <>
            {editable ? (
              <Drawer label="Change stage" title="Move this lead" icon={<ArrowRightLeft size={15} aria-hidden="true" />}>
                <form action={leadStatusAction} className="form">
                  <input type="hidden" name="id" value={lead.id} />
                  {nextStages.length ? (
                    <>
                      <p className="meta">Currently <strong>{lead.status}</strong></p>
                      <label>Move to<select name="status" defaultValue={nextStages[0]}>{nextStages.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
                      <label>Reason<input name="reason" placeholder="Required when marking lost" /></label>
                      <p className="help">Only moves allowed from the current stage are listed.{lead.status === "unqualified" ? " To qualify this lead again, move it back to contacted first." : ""} Converted leads stay linked to their customer.</p>
                      <div className="form-actions"><button className="btn btn-primary" type="submit">Save stage</button></div>
                    </>
                  ) : <p className="meta">No stage moves are available from {lead.status}.</p>}
                </form>
              </Drawer>
            ) : null}
            {editable ? <Link className="btn btn-secondary" href={`${base}?tab=activities`}><CalendarPlus size={15} aria-hidden="true" />Log activity</Link> : null}
            {preview?.ready ? <Link className="btn btn-primary" href={`${base}?tab=overview#convert`}>Convert</Link> : null}
          </>
        }
      />

      {lead.archivedAt ? <p className="alert warn" style={{ marginBottom: 16 }}>This lead is archived{lead.mergedIntoId ? " because it was merged into another lead" : ""}. It is kept for history and excluded from working views.</p> : null}

      <Tabs label="Lead sections" items={[
        { href: `${base}?tab=overview`, label: "Overview", current: tab === "overview" },
        { href: `${base}?tab=activities`, label: "Activities", count: open.length, current: tab === "activities" },
        { href: `${base}?tab=notes`, label: "Notes", count: notes.length, current: tab === "notes" },
        { href: `${base}?tab=history`, label: "History", current: tab === "history" },
      ]} />

      <div className="record">
        <div className="record-main">
          {tab === "overview" ? (
            <>
              <Panel title="Next step" actions={editable ? <Link href={`${base}?tab=activities`}>Schedule</Link> : null} flush>
                {open.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No follow-up is scheduled. Every active lead should have a next step.</p> : (
                  <div className="rows">
                    {open.slice(0, 3).map((activity) => (
                      <div key={activity.id}>
                        <div className="grow"><strong>{activity.subject}</strong><span className="meta">{activity.type.replace("_", " ")} · {activity.owner.name} · {activity.dueAt ? formatDateTime(activity.dueAt, actor.timezone, actor.locale) : "No due time"}</span></div>
                        {activity.dueAt && activity.dueAt.getTime() < now ? <Badge value="overdue" /> : null}
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Qualification" description="Budget, authority, need, and timeline captured from conversations">
                <form action={qualifyLeadAction} className="form">
                  <input type="hidden" name="id" value={lead.id} />
                  <div className="form-row">
                    {QUALIFICATION.map(([key, label]) => <label key={key}>{label}<input name={key} defaultValue={qualification[key] ?? ""} disabled={!editable} /></label>)}
                  </div>
                  <label>Use case and requirements<textarea name="use_case" defaultValue={qualification.use_case ?? ""} rows={3} disabled={!editable} /></label>
                  {editable ? <div className="form-actions"><button className="btn btn-secondary" type="submit">Save qualification</button></div> : null}
                </form>
              </Panel>

              {preview ? (
                <Panel title="Conversion" id="convert" description={preview.ready ? "Review what will be created. The lead is kept and linked." : undefined}>
                  {preview.ready ? (
                    <form action={convertLeadAction} className="form">
                      <input type="hidden" name="id" value={lead.id} />
                      <Idempotency />
                      <Props items={[
                        ["Customer", preview.existingContact ? `${preview.existingContact.customerName} (existing)` : `${preview.customerName} (new ${preview.kind})`],
                        ["Contact", preview.existingContact ? "Already on that customer" : `${preview.contactName}${preview.contactEmail ? ` · ${preview.contactEmail}` : ""}`],
                        ["Opportunity", `${preview.opportunityName} · ${formatMoney(preview.valueCents, preview.currency, actor.locale)}`],
                      ]} />
                      {preview.existingContact ? <p className="alert warn">This email already belongs to {preview.existingContact.customerName} ({preview.existingContact.customerCode}). It is linked below to avoid a duplicate company.</p> : null}
                      <label>Customer
                        <select name="existingCustomerId" defaultValue={preview.existingContact?.customerId ?? ""}>
                          <option value="">Create “{preview.customerName}”</option>
                          {preview.recentCustomers.map((customer) => <option key={customer.id} value={customer.id}>Link {customer.code} · {customer.name}</option>)}
                        </select>
                      </label>
                      <div className="form-actions"><button className="btn btn-primary" type="submit">Convert lead</button></div>
                    </form>
                  ) : <p className="meta">{lead.status === "converted" ? "This lead has been converted." : "Move the lead to qualified to convert it into a customer and opportunity."}</p>}
                  {lead.customerId ? <p style={{ marginTop: 10 }}><Link className="btn btn-secondary btn-sm" href={`/customers/${lead.customerId}`}>Open customer</Link></p> : null}
                </Panel>
              ) : null}

              <Panel title="Opportunities" flush>
                {lead.opportunities.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No opportunity yet. Converting a qualified lead opens one.</p> : (
                  <div className="rows">
                    {lead.opportunities.map((opportunity) => (
                      <Link key={opportunity.id} href={`/opportunities/${opportunity.id}`}>
                        <div className="grow"><strong>{opportunity.name}</strong><span className="meta">{opportunity.code} · {formatMoney(opportunity.valueCents, opportunity.currency, actor.locale)}</span></div>
                        <Badge value={opportunity.stage} />
                      </Link>
                    ))}
                  </div>
                )}
              </Panel>
            </>
          ) : null}

          {tab === "activities" ? (
            <>
              {editable ? (
                <Panel title="Log an activity" description="Follow-ups set the lead's next follow-up date. Repeating activities create one next occurrence when completed.">
                  <form action={crmActivityAction} className="form">
                    <input type="hidden" name="leadId" value={lead.id} />
                    <div className="form-row">
                      <label>Type<select name="type" defaultValue="follow_up">{ACTIVITY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      <label>Due<input name="dueAt" type="datetime-local" /></label>
                    </div>
                    <label>Subject<input name="subject" required placeholder="e.g. Call to confirm budget owner" /></label>
                    <label>Notes<textarea name="notes" rows={2} /></label>
                    <div className="row">
                      <label className="check">Repeat<select name="recurrence" defaultValue="none" style={{ width: "auto" }}><option value="none">Does not repeat</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
                      <button className="btn btn-primary" type="submit">Add activity</button>
                    </div>
                  </form>
                </Panel>
              ) : null}
              <Panel title="Open" flush>
                {open.length === 0 ? <Empty title="Nothing open" body="Schedule the next call, meeting, or follow-up." /> : (
                  <div className="rows">
                    {open.map((activity) => (
                      <form key={activity.id} action={completeActivityAction}>
                        <input type="hidden" name="id" value={activity.id} />
                        <input type="hidden" name="leadId" value={lead.id} />
                        <div className="grow">
                          <strong>{activity.subject}</strong>
                          <span className="meta">{activity.type.replace("_", " ")} · {activity.owner.name} · {activity.dueAt ? formatDateTime(activity.dueAt, actor.timezone, actor.locale) : "No due time"}{activity.recurrence !== "none" ? ` · repeats ${activity.recurrence}` : ""}</span>
                        </div>
                        {activity.dueAt && activity.dueAt.getTime() < now ? <Badge value="overdue" /> : null}
                        {can(actor, "leads.edit") ? <button className="btn btn-secondary btn-sm" type="submit">Complete</button> : null}
                      </form>
                    ))}
                  </div>
                )}
              </Panel>
              <Panel title="Completed" flush>
                {done.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No completed activities yet.</p> : (
                  <div className="rows">
                    {done.map((activity) => (
                      <div key={activity.id}>
                        <div className="grow"><strong>{activity.subject}</strong><span className="meta">{activity.type.replace("_", " ")} · {activity.owner.name} · completed {formatDateTime(activity.completedAt, actor.timezone, actor.locale)}</span></div>
                        <Badge value={activity.status} />
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </>
          ) : null}

          {tab === "notes" ? (
            <Panel title="Internal notes" description="Visible to your company only. Customers never see these.">
              {can(actor, "comments.create") ? <CrmNoteForm entityType="lead" entityId={lead.id} /> : null}
              <ol className="timeline" style={{ marginTop: 14 }}>
                {notes.length === 0 ? <li><span className="dot" /><span className="meta">No notes yet.</span></li> : notes.map((note) => (
                  <li key={note.id}><span className="dot" /><div><strong>{note.authorName}</strong><p style={{ marginTop: 2, whiteSpace: "pre-wrap" }}>{note.deleted ? "Removed. The audit record is retained." : note.body}</p><div className="meta">{formatDateTime(note.createdAt, actor.timezone, actor.locale)}</div></div></li>
                ))}
              </ol>
            </Panel>
          ) : null}

          {tab === "history" ? (
            <>
              <Panel title="Ownership history" description="Every assignment, transfer, and unassignment, with who made it and why" flush>
                {lead.assignments.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No assignment history yet.</p> : (
                  <div className="rows">
                    {lead.assignments.map((entry) => (
                      <div key={entry.id}>
                        <div className="grow">
                          <strong>{entry.assignmentType === "unassign" ? `Unassigned from ${entry.fromName ?? "nobody"}` : entry.fromName ? `${entry.fromName} → ${entry.toName ?? "team"}` : `Assigned to ${entry.toName ?? "team"}`}</strong>
                          <span className="meta">{entry.actorName} · {formatDateTime(entry.createdAt, actor.timezone, actor.locale)}{entry.reason ? ` · “${entry.reason}”` : ""}</span>
                        </div>
                        <Badge value={entry.assignmentType} />
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
              <Panel title="Activity timeline">
                <ol className="timeline">
                  {lead.timeline.length === 0 ? <li><span className="dot" /><span className="meta">No recorded activity.</span></li> : lead.timeline.map((event) => (
                    <li key={event.id}><span className="dot" /><div><strong>{event.summary}</strong><div className="meta">{event.actorName} · {formatDateTime(event.createdAt, actor.timezone, actor.locale)}</div></div></li>
                  ))}
                </ol>
              </Panel>
              <Panel title="Score history" flush>
                {lead.scoreEvents.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>The score has not changed yet.</p> : (
                  <div className="rows">
                    {lead.scoreEvents.map((event) => (
                      <div key={event.id}><div className="grow"><strong>Score {event.score}</strong><span className="meta">{formatDateTime(event.createdAt, actor.timezone, actor.locale)}</span></div></div>
                    ))}
                  </div>
                )}
              </Panel>
            </>
          ) : null}
        </div>

        <aside className="record-aside">
          <Panel title="Ownership">
            <Props items={[
              ["Owner", <Person key="owner" name={lead.owner?.name} inactive={lead.owner?.status === "inactive"} />],
              ["Marketing", lead.marketingOwner ? `${lead.marketingOwner.name}${lead.marketingOwner.status === "inactive" ? " (inactive)" : ""}` : "—"],
              ["Sales", lead.salesOwner ? `${lead.salesOwner.name}${lead.salesOwner.status === "inactive" ? " (inactive)" : ""}` : "—"],
              ["Account manager", lead.accountManager?.name ?? "—"],
              ["Team", lead.team ? `${lead.team.name}${lead.team.archivedAt ? " (archived)" : ""}` : "—"],
              ["Assigned", lead.assignedAt ? `${formatDate(lead.assignedAt, actor.timezone, actor.locale)}${lead.assignedBy ? ` by ${lead.assignedBy.name}` : ""}` : "—"],
              ["Reason", lead.assignmentReason || "—"],
            ]} />
            {lead.owner?.status === "inactive" ? <p className="alert warn" style={{ marginTop: 12 }}>The owner is inactive. Reassign this lead so it is not left without a working owner.</p> : null}
            {manager && !lead.archivedAt ? (
              <details className="inline-details" style={{ marginTop: 12 }}>
                <summary>Change assignment</summary>
                <form action={assignLeadAction} className="form">
                  <Idempotency />
                  <input type="hidden" name="ids" value={lead.id} />
                  <label>Employee<select name="userId" defaultValue=""><option value="">Choose…</option>{people.map((person) => {
                    const load = workload.get(person.id);
                    return <option key={person.id} value={person.id}>{person.name} · {load?.open ?? 0} open</option>;
                  })}</select></label>
                  <label>Role<select name="role" defaultValue="sales"><option value="sales">Sales owner</option><option value="marketing">Marketing owner</option><option value="account">Account manager</option></select></label>
                  <label>Reason<input name="reason" placeholder="Recorded in the audit log" /></label>
                  <label className="check"><input type="checkbox" name="transferFollowUps" value="1" /> Move open follow-ups to the new owner</label>
                  <div className="form-actions">
                    <button className="btn btn-ghost btn-sm" name="unassign" value="1" type="submit">Unassign</button>
                    <button className="btn btn-primary btn-sm" type="submit">Assign</button>
                  </div>
                </form>
              </details>
            ) : null}
          </Panel>

          <Panel title="Lead score">
            <div className="row" style={{ justifyContent: "flex-start", gap: 12 }}>
              <span className="big-score num">{lead.score}</span>
              <span className="meta">out of 100</span>
            </div>
            {lead.reasons.length ? <ul className="reasons">{lead.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p className="meta" style={{ marginTop: 8 }}>No scoring rule has matched this lead yet.</p>}
          </Panel>

          <Panel title="Details">
            <Props items={[
              ["Source", lead.source ?? "—"],
              ["Campaign", lead.campaign ? <Link key="campaign" href="/campaigns">{lead.campaign.name}</Link> : "—"],
              ["Estimated value", lead.estimatedValueCents != null ? formatMoney(lead.estimatedValueCents, lead.currency, actor.locale) : "—"],
              ["Next follow-up", lead.nextFollowUpAt ? formatDateTime(lead.nextFollowUpAt, actor.timezone, actor.locale) : "Not set"],
              ["Last activity", lead.lastActivityAt ? formatDateTime(lead.lastActivityAt, actor.timezone, actor.locale) : "None"],
              ["Created", formatDate(lead.createdAt, actor.timezone, actor.locale)],
              ["Customer", lead.customerId ? <Link key="customer" href={`/customers/${lead.customerId}`}>Open customer</Link> : "—"],
            ]} />
          </Panel>

          {lead.duplicates.length ? (
            <Panel title="Possible duplicates" className="danger-zone" flush>
              <div className="rows">
                {lead.duplicates.map((item) => (
                  <div key={item.id} style={{ flexWrap: "wrap" }}>
                    <div className="grow">
                      <strong>{item.kind === "lead" ? `${item.code} · ${item.name}` : `Contact · ${item.name}`}</strong>
                      <span className="meta">{item.email ?? item.phone ?? "Same domain"} · {item.status}</span>
                    </div>
                    {item.kind === "lead" && can(actor, "leads.merge") ? (
                      <form action={mergeLeadAction}>
                        <input type="hidden" name="sourceId" value={lead.id} />
                        <input type="hidden" name="targetId" value={item.id} />
                        <button className="btn btn-secondary btn-sm" type="submit" title="Moves this lead's history onto the other lead and archives this one">Merge into</button>
                      </form>
                    ) : item.kind === "lead" ? <Link className="btn btn-ghost btn-sm" href={`/leads/${item.id}`}>Open</Link> : null}
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
