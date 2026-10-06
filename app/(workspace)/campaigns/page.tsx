import { Plus } from "lucide-react";
import { campaignAction } from "@/app/actions";
import { CampaignForm } from "@/components/campaign-form";
import { RoutingForm } from "@/components/routing-form";
import { Badge, Drawer, Empty, PageHeader, Panel, StatStrip } from "@/components/ui";
import { can } from "@/lib/actor";
import { listAssignableEmployees, listCampaigns, listRoutingRules } from "@/lib/domain/leads";
import { formatMoney } from "@/lib/money";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const actor = await requireEmployee();
  const query = await searchParams;
  const routing = can(actor, "crm.routing");
  const [campaigns, rules, people] = await Promise.all([
    listCampaigns(actor),
    routing ? listRoutingRules(actor) : Promise.resolve([]),
    routing && can(actor, "leads.assign") ? listAssignableEmployees(actor) : Promise.resolve([]),
  ]);
  const names = new Map(people.map((person) => [person.id, person.name]));
  const totals = campaigns.reduce((sum, campaign) => ({
    leads: sum.leads + campaign.leads,
    qualified: sum.qualified + campaign.qualified,
    won: sum.won + campaign.wonCents,
    budget: sum.budget + (campaign.budgetCents ?? 0),
  }), { leads: 0, qualified: 0, won: 0, budget: 0 });

  return (
    <main>
      <PageHeader
        title="Campaigns"
        lede="Results come from leads and deals linked to each campaign. Cost per lead appears only when a budget and leads both exist."
        action={can(actor, "campaigns.manage") ? (
          <Drawer label="New campaign" title="New campaign" primary icon={<Plus size={15} aria-hidden="true" />} open={query.new === "1"}>
            <CampaignForm action={campaignAction} />
          </Drawer>
        ) : null}
      />

      <StatStrip items={[
        { label: "Active campaigns", value: campaigns.filter((campaign) => campaign.status === "active").length, hint: `${campaigns.length} total` },
        { label: "Leads generated", value: totals.leads },
        { label: "Qualified", value: totals.qualified, hint: totals.leads ? `${Math.round(totals.qualified / totals.leads * 100)}% of leads` : undefined },
        { label: "Won revenue", value: formatMoney(totals.won, actor.currency, actor.locale) },
        { label: "Budget", value: formatMoney(totals.budget, actor.currency, actor.locale) },
      ]} />

      <Panel title="Campaign performance" flush>
        {campaigns.length === 0 ? <Empty title="No campaigns yet" body="Create a campaign, then attach it when you add or import leads." /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Campaign</th><th>Status</th><th>Channel</th><th>Dates</th><th className="right">Leads</th><th className="right">Qualified</th><th className="right">Deals</th><th className="right">Won</th><th className="right">Budget</th><th className="right">Cost / lead</th></tr></thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td><strong>{campaign.name}</strong><div className="meta">{campaign.code}{campaign.audience ? ` · ${campaign.audience}` : ""}</div></td>
                    <td><Badge value={campaign.status} /></td>
                    <td style={{ textTransform: "capitalize" }}>{campaign.channel.replace("_", " ")}</td>
                    <td className="nowrap meta">{campaign.startsOn ?? "—"}{campaign.endsOn ? ` → ${campaign.endsOn}` : ""}</td>
                    <td className="right num">{campaign.leads}</td>
                    <td className="right num">{campaign.qualified}</td>
                    <td className="right num">{campaign.opportunities}</td>
                    <td className="right num">{formatMoney(campaign.wonCents, campaign.currency, actor.locale)}<div className="meta">{campaign.wonCount} won</div></td>
                    <td className="right num">{campaign.budgetCents != null ? formatMoney(campaign.budgetCents, campaign.currency, actor.locale) : <span className="meta">—</span>}</td>
                    <td className="right num">{campaign.costPerLead != null ? formatMoney(campaign.costPerLead, campaign.currency, actor.locale) : <span className="meta">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {routing ? (
        <Panel
          title="Lead routing rules"
          description="New leads without an owner are matched against enabled rules in order. The first match assigns the lead."
          actions={people.length ? <Drawer label="New rule" title="New routing rule" icon={<Plus size={15} aria-hidden="true" />}><RoutingForm people={people} /></Drawer> : null}
          flush
        >
          {rules.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No rules yet. Unmatched leads stay in the Unassigned queue for a manager.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Rule</th><th>Matches</th><th>Strategy</th><th>Assigns to</th><th>Status</th></tr></thead>
                <tbody>
                  {rules.map((rule, index) => {
                    const criteria = parse<{ source?: string; industry?: string; minScore?: number }>(rule.criteria, {});
                    const ids = parse<string[]>(rule.userIds, []);
                    const match = [criteria.source && `source ${criteria.source}`, criteria.industry && `industry ${criteria.industry}`, criteria.minScore != null && `score ≥ ${criteria.minScore}`].filter(Boolean).join(" · ") || "Every lead";
                    return (
                      <tr key={rule.id}>
                        <td className="num meta">{index + 1}</td>
                        <td><strong>{rule.name}</strong></td>
                        <td className="meta">{match}</td>
                        <td>{rule.strategy === "round_robin" ? "Round robin" : "First available"}</td>
                        <td>{ids.map((id) => names.get(id) ?? "Inactive employee").join(", ")}</td>
                        <td><Badge value={rule.enabled ? "enabled" : "disabled"} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}
    </main>
  );
}

function parse<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
