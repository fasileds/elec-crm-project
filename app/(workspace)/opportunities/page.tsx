import Link from "next/link";
import { Badge, Empty, PageHeader, Pager, Panel, Person, StatStrip } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { forecast, listOpportunities } from "@/lib/domain/leads";
import { formatMoney } from "@/lib/money";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "Opportunities" };

const OPEN_STAGES = ["qualification", "discovery", "requirements", "proposal", "negotiation", "verbal"];
const ALL_STAGES = [...OPEN_STAGES, "won", "lost"];

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; stage?: string; page?: string }> }) {
  const actor = await requireEmployee();
  const query = await searchParams;
  const board = query.view !== "list";
  const [result, picture] = await Promise.all([
    board ? listOpportunities(actor, { open: true, pageSize: 200, q: query.q }) : listOpportunities(actor, { q: query.q, stage: query.stage, page: Number(query.page ?? 1) }),
    forecast(actor),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const listHref = (page: number) => {
    const params = new URLSearchParams({ view: "list", page: String(page) });
    if (query.q) params.set("q", query.q);
    if (query.stage) params.set("stage", query.stage);
    return `/opportunities?${params.toString()}`;
  };

  return (
    <main>
      <PageHeader
        title="Opportunities"
        lede="Weighted forecast multiplies each open deal's value by its stage probability. It is a pipeline estimate, not recognized revenue."
        action={
          <div className="seg" role="group" aria-label="Layout">
            <Link href={`/opportunities${query.q ? `?q=${encodeURIComponent(query.q)}` : ""}`} aria-current={board ? "page" : undefined}>Board</Link>
            <Link href={`/opportunities?view=list${query.q ? `&q=${encodeURIComponent(query.q)}` : ""}`} aria-current={!board ? "page" : undefined}>List</Link>
          </div>
        }
      />

      <StatStrip items={[
        { label: "Open pipeline", value: formatMoney(picture.pipelineCents, picture.currency, actor.locale), hint: `${picture.openCount} open deals` },
        { label: "Weighted forecast", value: formatMoney(picture.weightedCents, picture.currency, actor.locale), hint: "Value × stage probability" },
        { label: "Win rate", value: picture.winRate == null ? "—" : `${picture.winRate}%`, hint: picture.winRate == null ? "No closed deals yet" : `${picture.wonCount} won · ${picture.lostCount} lost` },
        { label: "Won", value: picture.wonCount, href: "/opportunities?view=list&stage=won" },
        { label: "Lost", value: picture.lostCount, href: "/opportunities?view=list&stage=lost" },
      ]} />

      {board ? (
        result.items.length === 0 ? (
          <Panel><Empty title="No open opportunities" body="Convert a qualified lead to open the first deal." href="/leads?view=qualified" action="Qualified leads" /></Panel>
        ) : (
          <div className="board">
            {OPEN_STAGES.map((stage) => {
              const deals = result.items.filter((deal) => deal.stage === stage);
              const total = deals.reduce((sum, deal) => sum + deal.valueCents, 0);
              return (
                <section className="board-col" key={stage} aria-label={stage}>
                  <header className="board-col-head"><h3>{stage}</h3><span>{deals.length} · {formatMoney(total, picture.currency, actor.locale)}</span></header>
                  {deals.length === 0 ? <p className="board-empty">No deals</p> : deals.map((deal) => (
                    <Link key={deal.id} className="board-card" href={`/opportunities/${deal.id}`}>
                      <strong>{deal.name}</strong>
                      <span className="meta">{deal.customer.name}</span>
                      <div className="row">
                        <span className="num" style={{ fontWeight: 650, color: "var(--color-ink)" }}>{formatMoney(deal.valueCents, deal.currency, actor.locale)}</span>
                        <span className="chip">{deal.probability}%</span>
                      </div>
                      <div className="row">
                        <Person name={deal.owner?.name} inactive={deal.owner?.status === "inactive"} />
                        <span className="meta" style={deal.expectedCloseOn && deal.expectedCloseOn < today ? { color: "var(--color-bad)", fontWeight: 600 } : undefined}>{deal.expectedCloseOn ? formatDate(deal.expectedCloseOn, actor.timezone, actor.locale) : "No close date"}</span>
                      </div>
                    </Link>
                  ))}
                </section>
              );
            })}
          </div>
        )
      ) : (
        <Panel flush footer={<Pager page={result.page} pageSize={result.pageSize} total={result.total} href={listHref} />}>
          <form className="toolbar" action="/opportunities">
            <input type="hidden" name="view" value="list" />
            <input name="q" type="search" defaultValue={query.q} placeholder="Search deals or customers" aria-label="Search opportunities" />
            <select name="stage" defaultValue={query.stage ?? ""} aria-label="Stage"><option value="">All stages</option>{ALL_STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select>
            <button className="btn btn-secondary" type="submit">Apply</button>
          </form>
          {result.items.length === 0 ? <Empty title="No opportunities match" body="Clear the filters or convert a qualified lead." /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Deal</th><th>Customer</th><th>Stage</th><th className="right">Value</th><th className="right">Probability</th><th>Owner</th><th>Expected close</th></tr></thead>
                <tbody>
                  {result.items.map((deal) => (
                    <tr key={deal.id}>
                      <td><Link href={`/opportunities/${deal.id}`}><strong>{deal.name}</strong></Link><div className="meta">{deal.code}</div></td>
                      <td><Link href={`/customers/${deal.customer.id}`}>{deal.customer.name}</Link></td>
                      <td><Badge value={deal.stage} /></td>
                      <td className="right num">{formatMoney(deal.valueCents, deal.currency, actor.locale)}</td>
                      <td className="right num">{deal.probability}%</td>
                      <td><Person name={deal.owner?.name} inactive={deal.owner?.status === "inactive"} /></td>
                      <td className="nowrap">{deal.expectedCloseOn ? formatDate(deal.expectedCloseOn, actor.timezone, actor.locale) : <span className="meta">Not set</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </main>
  );
}
