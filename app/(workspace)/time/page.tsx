import { TimeForm } from "@/components/time-form";
import { Badge, PageHeader, Panel, Person, StatStrip } from "@/components/ui";
import { formatDate, todayInTimeZone } from "@/lib/dates";
import { listProjects } from "@/lib/domain/projects";
import { listTime } from "@/lib/domain/time";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "Time" };

function hours(minutes: number) {
  return `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)}h`;
}

export default async function TimePage() {
  const actor = await requireEmployee();
  const [projects, entries] = await Promise.all([
    listProjects(actor, {}),
    actor.permissions.includes("time.view") ? listTime(actor, {}) : Promise.resolve([]),
  ]);
  const today = todayInTimeZone(actor.timezone);
  const weekStart = new Date(`${today}T00:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  const weekKey = weekStart.toISOString().slice(0, 10);
  const mine = entries.filter((entry) => entry.userId === actor.userId);
  const sum = (list: typeof entries) => list.reduce((total, entry) => total + entry.minutes, 0);

  return (
    <main>
      <PageHeader title="Time" lede="Entries cannot be in the future, negative, or push a day past 24 hours. Corrections keep the previous value." />
      <StatStrip items={[
        { label: "Logged today", value: hours(sum(mine.filter((entry) => entry.workOn === today))) },
        { label: "This week", value: hours(sum(mine.filter((entry) => entry.workOn >= weekKey))), hint: `Since ${formatDate(weekKey, actor.timezone, actor.locale)}` },
        { label: "Entries shown", value: entries.length, hint: "Most recent 200" },
        { label: "Total in view", value: hours(sum(entries)) },
      ]} />

      <div className="record">
        <Panel title="Time entries" flush>
          {entries.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No time recorded yet.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Person</th><th>Project</th><th>Note</th><th className="right">Time</th><th>Status</th></tr></thead>
                <tbody>
                  {entries.slice(0, 60).map((entry) => (
                    <tr key={entry.id}>
                      <td className="nowrap">{formatDate(entry.workOn, actor.timezone, actor.locale)}</td>
                      <td><Person name={entry.user.name} /></td>
                      <td>{entry.project.name}<div className="meta">{entry.project.code}</div></td>
                      <td className="meta">{entry.note || "—"}</td>
                      <td className="right num"><strong>{hours(entry.minutes)}</strong><div className="meta">{entry.minutes} min</div></td>
                      <td><Badge value={entry.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <aside className="record-aside">
          <Panel title="Log time">
            <TimeForm projects={projects.items.map((project) => ({ id: project.id, name: project.name }))} today={today} />
          </Panel>
        </aside>
      </div>
    </main>
  );
}
