import { readAllAction, readNotificationAction } from "@/app/actions";
import { Empty, PageHeader } from "@/components/ui";
import { listNotifications } from "@/lib/domain/insights";
import { requireCustomer } from "@/lib/session";

export const metadata = { title: "Notifications" };

export default async function PortalNotifications() {
  const actor = await requireCustomer();
  const data = await listNotifications(actor);
  return (
    <main>
      <PageHeader kicker="Inbox" title="Notifications" lede={`${data.unread} unread.`} action={<form action={readAllAction}><button className="btn btn-secondary" type="submit">Mark all read</button></form>} />
      <div className="card">
        {data.items.length === 0 ? <Empty title="No notifications" body="Replies and project updates will show up here." /> : data.items.map((item) => (
          <form key={item.id} action={readNotificationAction} className="item">
            <input type="hidden" name="id" value={item.id} />
            <strong>{item.title}</strong>
            <p>{item.body}</p>
            <a href={item.href.startsWith("/projects") ? item.href.replace("/projects", "/portal/projects") : item.href}>Open</a>
            {item.readAt ? null : <button className="btn btn-secondary" type="submit">Mark read</button>}
          </form>
        ))}
      </div>
    </main>
  );
}
