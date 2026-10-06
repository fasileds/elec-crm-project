import Link from "next/link";
import { Upload, UserPlus } from "lucide-react";
import { assignLeadAction, importLeadsAction } from "@/app/actions";
import { ImportForm } from "@/components/import-form";
import { LeadForm } from "@/components/lead-form";
import { Idempotency } from "@/components/form";
import { Badge, Drawer, Empty, PageHeader, Pager, Panel, Person, Score, StatStrip, Tabs } from "@/components/ui";
import { dataQuality, leadWorkload, listAssignableEmployees, listCampaignOptions, listCrmTeams, listLeads, slaBreaches } from "@/lib/domain/leads";
import { can } from "@/lib/actor";
import { formatDate, formatDateTime } from "@/lib/dates";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "Leads" };

type Query = { q?: string; status?: string; view?: string; page?: string; priority?: string; source?: string; ownerId?: string; new?: string };

const SOURCES = ["website", "referral", "outbound", "event", "partner", "other"];

function capped(count: number) {
  return count >= 20 ? "20+" : String(count);
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const actor = await requireEmployee();
  const query = await searchParams;
  const manager = can(actor, "leads.assign");
  const result = await listLeads(actor, { q: query.q, status: query.status, view: query.view, priority: query.priority, source: query.source, ownerId: manager ? query.ownerId : undefined, page: Number(query.page ?? 1) });
  const [people, teams, quality, breaches, workload, campaigns] = await Promise.all([
    manager ? listAssignableEmployees(actor) : Promise.resolve([]),
    manager ? listCrmTeams(actor) : Promise.resolve([]),
    manager ? dataQuality(actor) : Promise.resolve(null),
    manager ? slaBreaches(actor) : Promise.resolve([]),
    manager ? leadWorkload(actor) : Promise.resolve(new Map<string, { open: number; overdue: number }>()),
    can(actor, "leads.create") ? listCampaignOptions(actor) : Promise.resolve([]),
  ]);
  const view = query.view ?? "";
  const href = (next: Partial<Query>) => {
    const params = new URLSearchParams();
    const merged = { ...query, ...next };
    for (const [key, value] of Object.entries(merged)) if (value && key !== "new") params.set(key, String(value));
    const text = params.toString();
    return text ? `/leads?${text}` : "/leads";
  };
  const tabs = [
    { href: "/leads", label: "All open", current: view === "" },
    { href: "/leads?view=mine", label: "My leads", count: result.queues.mine, current: view === "mine" },
    ...(manager ? [{ href: "/leads?view=unassigned", label: "Unassigned", count: result.queues.unassigned, current: view === "unassigned", alert: true }] : []),
    { href: "/leads?view=overdue", label: "Overdue", count: result.queues.overdue, current: view === "overdue", alert: true },
    { href: "/leads?view=hot", label: "Hot", count: result.queues.hot, current: view === "hot" },
    { href: "/leads?view=recent", label: "Recent", current: view === "recent" },
    { href: "/leads?view=new", label: "New", current: view === "new" },
    { href: "/leads?view=nurturing", label: "Nurturing", count: result.queues.nurturing, current: view === "nurturing" },
    { href: "/leads?view=qualified", label: "Qualified", current: view === "qualified" },
    { href: "/leads?view=converted", label: "Converted", current: view === "converted" },
    { href: "/leads?view=lost", label: "Lost", current: view === "lost" },
    { href: "/leads?view=team", label: "My team", current: view === "team" },
  ];
  const now = new Date().getTime();
  const busiest = Math.max(1, ...people.map((person) => workload.get(person.id)?.open ?? 0));

  return (
    <main>
      <PageHeader
        title="Leads"
        lede="Every lead has an owner, a next step, and a recorded history. Assignment notifies the new owner and is written to the audit log."
        action={
          <>
            {can(actor, "crm.import") ? <Drawer label="Import" title="Import leads from CSV" icon={<Upload size={15} aria-hidden="true" />} wide><ImportForm action={importLeadsAction} /></Drawer> : null}
            {can(actor, "leads.create") ? <Drawer label="New lead" title="New lead" primary open={query.new === "1"} icon={<UserPlus size={15} aria-hidden="true" />} wide><LeadForm campaigns={campaigns} /></Drawer> : null}
          </>
        }
      />

      {quality ? (
        <StatStrip items={[
          { label: "Unassigned", value: result.queues.unassigned, href: "/leads?view=unassigned", tone: result.queues.unassigned ? "now" : "", hint: "Waiting for an owner" },
          { label: "Overdue follow-ups", value: result.queues.overdue, href: "/leads?view=overdue", tone: result.queues.overdue ? "now" : "", hint: "Past their next step" },
          { label: "Response time breached", value: breaches.length, href: "#attention", tone: breaches.length ? "soon" : "", hint: "Against priority SLA" },
          { label: "No follow-up set", value: capped(quality.noFollowUp.length), hint: "Open leads without a next step" },
          { label: "Never contacted", value: capped(quality.stale.length), hint: "Older than 3 days" },
        ]} />
      ) : (
        <StatStrip items={[
          { label: "My open leads", value: result.queues.mine, href: "/leads?view=mine" },
          { label: "Overdue follow-ups", value: result.queues.overdue, href: "/leads?view=overdue", tone: result.queues.overdue ? "now" : "" },
          { label: "Hot", value: result.queues.hot, href: "/leads?view=hot" },
          { label: "Nurturing", value: result.queues.nurturing, href: "/leads?view=nurturing" },
        ]} />
      )}

      <Tabs label="Lead views" items={tabs} />

      <div className="page-stack">
        <Panel
          flush
          footer={<Pager page={result.page} pageSize={result.pageSize} total={result.total} href={(page) => href({ page: String(page) })} />}
        >
          <form className="toolbar" action="/leads">
            {query.view ? <input type="hidden" name="view" value={query.view} /> : null}
            <input name="q" type="search" defaultValue={query.q} placeholder="Search name, company, email, code" aria-label="Search leads" />
            <select name="priority" defaultValue={query.priority ?? ""} aria-label="Priority"><option value="">Any priority</option>{["critical", "high", "medium", "low"].map((item) => <option key={item}>{item}</option>)}</select>
            <select name="source" defaultValue={query.source ?? ""} aria-label="Source"><option value="">Any source</option>{SOURCES.map((item) => <option key={item}>{item}</option>)}</select>
            <button className="btn btn-secondary" type="submit">Apply</button>
            {query.ownerId ? <input type="hidden" name="ownerId" value={query.ownerId} /> : null}
            {query.q || query.priority || query.source || query.ownerId ? <Link className="btn btn-ghost" href={query.view ? `/leads?view=${query.view}` : "/leads"}>Clear</Link> : null}
          </form>
          {result.items.length === 0 ? (
            <Empty title="No leads in this view" body={view === "unassigned" ? "Every open lead has an owner." : view === "overdue" ? "No open lead is past its follow-up date." : "Try another view, clear the filters, or create a lead."} />
          ) : (
            <form action={assignLeadAction}>
              <Idempotency />
              {manager ? (
                <div className="bulkbar">
                  <span className="label">Selected</span>
                  <select name="userId" defaultValue="" aria-label="Assign to employee">
                    <option value="">Assign to…</option>
                    {people.map((person) => {
                      const load = workload.get(person.id);
                      return <option key={person.id} value={person.id}>{person.name} · {load?.open ?? 0} open{load?.overdue ? `, ${load.overdue} overdue` : ""}</option>;
                    })}
                  </select>
                  <select name="role" defaultValue="sales" aria-label="Ownership role"><option value="sales">as Sales owner</option><option value="marketing">as Marketing owner</option><option value="account">as Account manager</option></select>
                  {teams.length ? <select name="teamId" defaultValue="" aria-label="Team"><option value="">Keep team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select> : null}
                  <input name="reason" placeholder="Reason (recorded)" aria-label="Assignment reason" />
                  <label className="check"><input type="checkbox" name="transferFollowUps" value="1" /> Move follow-ups</label>
                  <span style={{ flex: 1 }} />
                  <button className="btn btn-secondary btn-sm" name="unassign" value="1" type="submit">Unassign</button>
                  <button className="btn btn-primary btn-sm" type="submit">Assign</button>
                </div>
              ) : null}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {manager ? <th className="check"><span className="sr-only">Select</span></th> : null}
                      <th>Lead</th>
                      <th>Stage</th>
                      <th>Score</th>
                      <th>Owner</th>
                      <th>Source</th>
                      <th>Next follow-up</th>
                      <th>Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((lead) => {
                      const overdue = lead.nextFollowUpAt && lead.nextFollowUpAt.getTime() < now && !["converted", "lost", "archived", "unqualified"].includes(lead.status);
                      return (
                        <tr key={lead.id}>
                          {manager ? <td className="check"><input type="checkbox" name="ids" value={lead.id} aria-label={`Select ${lead.name}`} /></td> : null}
                          <td>
                            <Link href={`/leads/${lead.id}`}><strong>{lead.name}</strong></Link>
                            <div className="meta">{lead.code} · {lead.company || "Individual"}{lead.priority === "high" || lead.priority === "critical" ? ` · ${lead.priority} priority` : ""}</div>
                          </td>
                          <td><Badge value={lead.status} /></td>
                          <td><span title={lead.reasons.join("; ") || "No scoring rule matched"}><Score value={lead.score} /></span></td>
                          <td>
                            <Person name={lead.owner?.name} inactive={lead.owner?.status === "inactive"} />
                            {lead.marketingOwner && lead.marketingOwner.id !== lead.owner?.id ? <div className="meta">Marketing: {lead.marketingOwner.name}</div> : null}
                          </td>
                          <td><span className="meta">{lead.source ?? "—"}{lead.campaign ? ` · ${lead.campaign.name}` : ""}</span></td>
                          <td className="nowrap">{lead.nextFollowUpAt ? <span style={overdue ? { color: "var(--color-bad)", fontWeight: 600 } : undefined}>{formatDateTime(lead.nextFollowUpAt, actor.timezone, actor.locale)}</span> : <span className="meta">Not set</span>}</td>
                          <td className="nowrap meta">{lead.lastActivityAt ? formatDate(lead.lastActivityAt, actor.timezone, actor.locale) : "None"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </form>
          )}
        </Panel>

        {manager ? (
          <div className="dash-pair">
            <Panel title="Team workload" description="Open leads owned per employee">
              {people.length === 0 ? <p className="meta">No active employee can work leads.</p> : (
                <div className="bars">
                  {people.map((person) => {
                    const load = workload.get(person.id) ?? { open: 0, overdue: 0 };
                    return (
                      <Link className="bar-row" key={person.id} href={`/leads?ownerId=${person.id}`} style={{ gridTemplateColumns: "minmax(80px, 120px) 1fr 52px", textTransform: "none" }}>
                        <span>{person.name}</span>
                        <div className={load.overdue ? "bar accent" : "bar"}><span style={{ width: `${(load.open / busiest) * 100}%` }} /></div>
                        <strong>{load.open}{load.overdue ? <span className="meta" style={{ color: "var(--color-bad)" }}> ·{load.overdue}</span> : null}</strong>
                      </Link>
                    );
                  })}
                </div>
              )}
              <p className="meta" style={{ marginTop: 12 }}>Red bars have overdue follow-ups. Inactive employees are never offered as owners.</p>
            </Panel>
            <Panel title="Needs attention" id="attention" flush>
              {breaches.length === 0 && (quality?.overdue.length ?? 0) === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No response-time breaches or overdue follow-ups.</p> : (
                <div className="rows">
                  {breaches.slice(0, 6).map((lead) => (
                    <Link key={lead.id} href={`/leads/${lead.id}`}>
                      <div className="grow"><strong>{lead.name}</strong><span className="meta">{lead.code} · first response overdue</span></div>
                      <Badge value={lead.priority} />
                    </Link>
                  ))}
                  {quality?.overdue.slice(0, 6).map((lead) => (
                    <Link key={lead.id} href={`/leads/${lead.id}`}>
                      <div className="grow"><strong>{lead.name}</strong><span className="meta">{lead.code} · follow-up was {formatDate(lead.nextFollowUpAt, actor.timezone, actor.locale)}</span></div>
                      <Badge value="overdue" />
                    </Link>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        ) : null}
      </div>
    </main>
  );
}
