import Link from "next/link";
import { readAllAction, readNotificationAction } from "@/app/actions";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { listNotifications } from "@/lib/domain/insights";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const actor = await requireEmployee();
  const data = await listNotifications(actor);
  return (
    <main>
      <PageHeader
        title="Notifications"
        lede={`${data.unread} unread. The same event never creates a second notification.`}
        action={data.unread ? <form action={readAllAction}><button className="btn btn-secondary" type="submit">Mark all read</button></form> : null}
      />
      <Panel flush>
        {data.items.length === 0 ? <Empty title="You are caught up" body="Assignments, comments, approvals and deadlines will appear here." /> : (
          <div className="rows">
            {data.items.map((item) => (
              <form key={item.id} action={readNotificationAction} className={item.readAt ? undefined : "unread"}>
                <input type="hidden" name="id" value={item.id} />
                <span className={item.readAt ? "dot-read" : "dot-unread"} aria-label={item.readAt ? "Read" : "Unread"} />
                <div className="grow">
                  <strong>{item.title}</strong>
                  <span className="meta">{item.body} · {formatDateTime(item.createdAt, actor.timezone, actor.locale)}</span>
                </div>
                {item.href ? <Link className="btn btn-ghost btn-sm" href={item.href}>Open</Link> : null}
                {item.readAt ? null : <button className="btn btn-secondary btn-sm" type="submit">Mark read</button>}
              </form>
            ))}
          </div>
        )}
      </Panel>
    </main>
  );
}
