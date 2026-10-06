import { approvalAction } from "@/app/actions";
import { Empty, PageHeader } from "@/components/ui";
import { listApprovals } from "@/lib/domain/requirements";
import { requireCustomer } from "@/lib/session";

export const metadata = { title: "Your decisions" };

export default async function PortalApprovals() {
  const actor = await requireCustomer();
  const approvals = await listApprovals(actor);
  return (
    <main>
      <PageHeader kicker="Decisions" title="Waiting on you" lede="Approve or reject items your team has asked you to decide." />
      <div className="card">
        {approvals.length === 0 ? <Empty title="No decisions waiting" body="When a requirement or change needs your approval, it will appear here." /> : approvals.map((approval) => (
          <form key={approval.id} action={approvalAction} className="item grid">
            <input type="hidden" name="id" value={approval.id} />
            <strong>{approval.entityType.replaceAll("_", " ")}</strong>
            <label>Comment<input name="comment" /></label>
            <div className="filters">
              <button className="btn btn-primary" name="decision" value="approved" type="submit">Approve</button>
              <button className="btn btn-danger" name="decision" value="rejected" type="submit">Reject</button>
            </div>
          </form>
        ))}
      </div>
    </main>
  );
}
