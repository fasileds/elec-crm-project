import Link from "next/link";
import { approvalAction } from "@/app/actions";
import { Badge, Empty, PageHeader, Panel } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { listApprovals } from "@/lib/domain/requirements";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const actor = await requireEmployee();
  const approvals = await listApprovals(actor);
  return (
    <main>
      <PageHeader title="Approvals" lede="A decision is recorded once with your note. Repeating it will not change the outcome." badges={approvals.length ? <Badge value={`${approvals.length} pending`} /> : undefined} />
      <Panel flush>
        {approvals.length === 0 ? <Empty title="Nothing is waiting" body="Requirement and change-request decisions will show up here." /> : (
          <div className="rows">
            {approvals.map((approval) => (
              <form key={approval.id} action={approvalAction}>
                <input type="hidden" name="id" value={approval.id} />
                <div className="grow">
                  <strong style={{ textTransform: "capitalize" }}>{approval.entityType.replaceAll("_", " ")}</strong>
                  <span className="meta">Requested {formatDateTime(approval.createdAt, actor.timezone, actor.locale)}{approval.projectId ? <> · <Link href={`/projects/${approval.projectId}?tab=${approval.entityType === "change_request" ? "changes" : "requirements"}`}>Open project</Link></> : null}</span>
                </div>
                <input name="comment" placeholder="Decision note" aria-label="Decision note" style={{ width: 260, minHeight: 32 }} />
                <button className="btn btn-danger btn-sm" name="decision" value="rejected" type="submit">Reject</button>
                <button className="btn btn-primary btn-sm" name="decision" value="approved" type="submit">Approve</button>
              </form>
            ))}
          </div>
        )}
      </Panel>
    </main>
  );
}
