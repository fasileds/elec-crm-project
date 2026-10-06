import Link from "next/link";
import { Badge, Empty, PageHeader, Panel, Tabs } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { listAudit, listEmails, listLookups } from "@/lib/domain/insights";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "Settings" };

const TABS = ["lookups", "email", "audit"] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireEmployee();
  const { tab: raw } = await searchParams;
  const manage = actor.permissions.includes("settings.manage");
  const auditable = actor.permissions.includes("audit.view");
  const available = TABS.filter((item) => (item === "audit" ? auditable : manage));
  const tab = available.find((item) => item === raw) ?? available[0];
  const [lookups, emails, audit] = await Promise.all([
    tab === "lookups" ? listLookups(actor) : Promise.resolve([]),
    tab === "email" ? listEmails(actor) : Promise.resolve([]),
    tab === "audit" ? listAudit(actor) : Promise.resolve(null),
  ]);
  const groups = new Map<string, typeof lookups>();
  for (const option of lookups) groups.set(option.kind, [...(groups.get(option.kind) ?? []), option]);

  return (
    <main>
      <PageHeader title="Settings" lede="Labels can change. Required workflow statuses stay available so historical records remain valid." action={actor.permissions.includes("srs.templates") ? <Link className="btn btn-secondary" href="/settings/srs-templates">SRS templates</Link> : null} />
      {available.length === 0 ? <Panel><Empty title="No settings for your role" body="Ask an administrator for settings or audit access." /></Panel> : (
        <>
          <Tabs label="Settings sections" items={available.map((item) => ({
            href: `/settings?tab=${item}`,
            label: item === "lookups" ? "Workflow options" : item === "email" ? "Email delivery" : "Audit log",
            current: tab === item,
          }))} />

          {tab === "lookups" ? (
            <div className="dash-pair lookups">
              {[...groups.entries()].map(([kind, options]) => (
                <Panel key={kind} title={<span style={{ textTransform: "capitalize" }}>{kind.replaceAll("_", " ")}</span>} description={`${options.filter((option) => option.enabled).length} of ${options.length} enabled`} flush>
                  <div className="rows">
                    {options.map((option) => (
                      <div key={option.id}>
                        <div className="grow"><strong>{option.label}</strong><span className="meta">{option.key}</span></div>
                        <Badge value={option.enabled ? "enabled" : "inactive"} />
                      </div>
                    ))}
                  </div>
                </Panel>
              ))}
            </div>
          ) : null}

          {tab === "email" ? (
            <Panel title="Outbox" description="A provider outage leaves the business record intact and keeps the email for retry." flush>
              {emails.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No messages yet.</p> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Template</th><th>Recipient</th><th>Status</th><th className="right">Attempts</th><th>Last error</th><th>Created</th></tr></thead>
                    <tbody>
                      {emails.map((email) => (
                        <tr key={email.id}>
                          <td><strong>{email.template.replaceAll("_", " ")}</strong></td>
                          <td>{email.toEmail}</td>
                          <td><Badge value={email.status} /></td>
                          <td className="right num">{email.attempts}</td>
                          <td className="meta">{email.lastError ?? "—"}</td>
                          <td className="nowrap meta">{formatDateTime(email.createdAt, actor.timezone, actor.locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          ) : null}

          {tab === "audit" && audit ? (
            <Panel title="Audit log" description={`${audit.total} recorded events`} flush>
              {audit.items.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No audited actions yet.</p> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Record</th></tr></thead>
                    <tbody>
                      {audit.items.map((entry) => (
                        <tr key={entry.id}>
                          <td className="nowrap meta">{formatDateTime(entry.createdAt, actor.timezone, actor.locale)}</td>
                          <td>{entry.actorName}</td>
                          <td><code className="chip">{entry.action}</code></td>
                          <td className="meta">{entry.entityType}{entry.entityId ? ` · ${entry.entityId.slice(-8)}` : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          ) : null}
        </>
      )}
    </main>
  );
}
