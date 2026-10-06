import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { ArrangeDashboard, CommandCenter } from "@/components/command-center";
import { Drawer, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { dashboard } from "@/lib/domain/insights";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const actor = await requireEmployee();
  const query = await searchParams;
  const data = await dashboard(actor, Number(query.range ?? 30));
  return (
    <main>
      <PageHeader
        kicker={`${data.lens.label} · ${formatDate(data.today, actor.timezone, actor.locale)}`}
        title={`Good to see you, ${actor.name.split(" ")[0]}`}
        lede={`Counts are live. Activity covers the last ${data.rangeDays} days.`}
        action={
          <>
            <div className="seg" role="group" aria-label="Activity window">
              {[7, 30, 90].map((days) => (
                <Link key={days} href={`/dashboard?range=${days}`} aria-current={data.rangeDays === days ? "page" : undefined}>{days} days</Link>
              ))}
            </div>
            <Drawer label="Customize" title="Arrange dashboard" icon={<SlidersHorizontal size={15} aria-hidden="true" />}>
              <ArrangeDashboard widgets={data.widgets} />
            </Drawer>
          </>
        }
      />
      <CommandCenter data={data} locale={actor.locale} timeZone={actor.timezone} />
    </main>
  );
}
