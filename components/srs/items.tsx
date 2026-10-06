import Link from "next/link";
import { srsAction } from "@/app/srs-actions";
import { Badge, Drawer, Panel } from "@/components/ui";
import { WorkflowBuilder } from "@/components/srs/workflow-builder";
import { ITEM_TRANSITIONS, KINDS, ORIGINS, ORIGIN_LABELS, PRIORITIES, PRIORITY_LABELS, QA_LABELS, QA_STATUSES, type Origin } from "@/lib/domain/srs/catalog";
import type { getSrsWorkspace } from "@/lib/domain/srs/workflow";

type Workspace = Awaited<ReturnType<typeof getSrsWorkspace>>;
type Item = Workspace["items"][number];
export type Caps = { userId: string; edit: boolean; requirements: boolean; approve: boolean; verify: boolean; clarify: boolean; internal: boolean; tasks: boolean; milestones: boolean; customer: boolean };

export function OriginTag({ origin }: { origin: string }) {
  return <span className={`origin-tag ${origin}`}>{ORIGIN_LABELS[origin as Origin] ?? origin}</span>;
}

function Hidden({ values }: { values: Record<string, string | number> }) {
  return <>{Object.entries(values).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>;
}

export function ItemForm({ kind, doc, back, item, team, caps, locked }: { kind: string; doc: string; back: string; item?: Item; team: Workspace["team"]; caps: Caps; locked: boolean }) {
  const meta = KINDS[kind];
  const data = item ? (JSON.parse(item.data || "{}") as Record<string, unknown>) : {};
  const disabled = locked;
  return (
    <form action={srsAction} className="form">
      <Hidden values={{ intent: item ? "item.update" : "item.create", doc, back, kind, ...(item ? { item: item.id, version: item.version } : {}) }} />
      <label>{kind === "definition" ? "Term" : "Title"}<input name="title" required minLength={2} maxLength={240} defaultValue={item?.title} disabled={disabled} /></label>
      <label>{kind === "definition" ? "Definition" : "Description"}<textarea name="description" rows={4} defaultValue={item?.description} disabled={disabled} /></label>
      <div className="form-grid">
        <label>Priority<select name="priority" defaultValue={item?.priority ?? "should"} disabled={disabled}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}</select></label>
        <label>Source<select name="origin" defaultValue={item?.origin ?? "elec_proposal"} disabled={disabled}>{ORIGINS.map((o) => <option key={o} value={o}>{ORIGIN_LABELS[o]}</option>)}</select></label>
        {caps.internal ? <label>Visibility<select name="visibility" defaultValue={item?.visibility ?? "shared"} disabled={disabled}><option value="shared">Client document</option><option value="internal">Internal note only</option></select></label> : null}
        <label>Owner<select name="ownerId" defaultValue={item?.ownerId ?? ""} disabled={disabled}><option value="">Unassigned</option>{team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      {meta.fields.map((field) => (
        <label key={field.key}>
          {field.label}
          {field.type === "select" ? (
            <select name={`data.${field.key}`} defaultValue={String(data[field.key] ?? "")} disabled={disabled}><option value="">—</option>{field.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          ) : field.type === "longtext" || field.type === "list" ? (
            <textarea name={`data.${field.key}`} rows={field.type === "list" ? 4 : 3} defaultValue={String(data[field.key] ?? "")} disabled={disabled} />
          ) : (
            <input name={`data.${field.key}`} type={field.type === "url" ? "url" : "text"} defaultValue={String(data[field.key] ?? "")} disabled={disabled} placeholder={field.type === "url" ? "https://" : undefined} />
          )}
          {field.help ? <span className="help">{field.help}</span> : null}
        </label>
      ))}
      {kind === "workflow" ? <WorkflowBuilder initial={(data.steps as never[]) ?? []} disabled={disabled} /> : null}
      {item?.approvedAt ? <label>Reason for change<input name="reason" required minLength={5} placeholder="Required: this item was approved" disabled={disabled} /><span className="help">Changing an approved item records a revision and flags it for re-approval.</span></label> : null}
      {!disabled ? <div className="form-actions"><button className="btn btn-primary" type="submit">{item ? "Save changes" : `Add ${meta.label.toLowerCase()}`}</button></div> : null}
    </form>
  );
}

export function ItemTable({ kind, items, href, doc, back, team, caps, locked, comments }: { kind: string; items: Item[]; href: (id: string) => string; doc: string; back: string; team: Workspace["team"]; caps: Caps; locked: boolean; comments: Workspace["comments"] }) {
  const meta = KINDS[kind];
  const list = items.filter((i) => i.kind === kind);
  const canAdd = !caps.customer && !locked && (["functional", "nonfunctional", "use_case", "user_story", "business_rule", "workflow"].includes(kind) ? caps.requirements : caps.edit);
  return (
    <Panel
      title={meta.plural}
      description={list.length ? `${list.length} item${list.length === 1 ? "" : "s"}` : undefined}
      flush
      actions={canAdd ? <Drawer label={`Add ${meta.label.toLowerCase()}`} title={`New ${meta.label.toLowerCase()}`} wide><ItemForm kind={kind} doc={doc} back={back} team={team} caps={caps} locked={false} /></Drawer> : null}
    >
      {list.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>None yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>{kind === "definition" ? "Term" : "Title"}</th><th>Priority</th><th>Source</th><th>Status</th>{meta.criteria ? <th>Criteria</th> : null}<th /></tr></thead>
            <tbody>
              {list.map((item) => {
                const open = comments.filter((c) => c.targetKey === item.key && c.status !== "resolved" && !c.parentId).length;
                return (
                  <tr key={item.id} className={item.visibility === "internal" ? "row-internal" : undefined}>
                    <td className="nowrap"><Link href={href(item.id)}><strong>{item.key}</strong></Link></td>
                    <td>
                      <Link href={href(item.id)}>{item.title}</Link>
                      {item.visibility === "internal" ? <span className="badge warn" style={{ marginLeft: 6 }}>internal</span> : null}
                      {item.reapprovalRequired ? <span className="badge bad" style={{ marginLeft: 6 }}>re-approval</span> : null}
                      {item.description ? <div className="meta clamp">{item.description}</div> : null}
                    </td>
                    <td className="nowrap meta">{PRIORITY_LABELS[item.priority]?.split(" ")[0] ?? item.priority}</td>
                    <td><OriginTag origin={item.origin} /></td>
                    <td><Badge value={item.status} /></td>
                    {meta.criteria ? <td className="meta nowrap">{item.criteria.length ? `${item.criteria.filter((c) => c.qaStatus === "passed").length}/${item.criteria.length} passed` : "None"}</td> : null}
                    <td className="meta nowrap">{open ? `${open} open` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function ItemDetail({ item, ws, back, closeHref, caps, locked }: { item: Item; ws: Workspace; back: string; closeHref: string; caps: Caps; locked: boolean }) {
  const meta = KINDS[item.kind];
  const doc = ws.doc.id;
  const lockedFlow = ["approved", "implemented", "verified"];
  const next = (ITEM_TRANSITIONS[item.status] ?? []).filter((to) => {
    if (caps.customer) return false;
    if (locked && !(lockedFlow.includes(item.status) && lockedFlow.includes(to))) return false;
    if (to === "approved" || to === "rejected") return caps.approve;
    if (to === "verified") return caps.verify;
    if (to === "clarification_required") return caps.clarify;
    return caps.requirements || caps.edit;
  });
  const thread = ws.comments.filter((c) => c.targetType === "item" && c.targetKey === item.key);
  const linkedTasks = item.links.filter((l) => l.targetType === "task");
  const linkedMilestones = item.links.filter((l) => l.targetType === "milestone");
  return (
    <Panel
      title={<>{item.key} · {item.title}</>}
      description={`${meta.label} · created by ${item.createdByName}${item.approvedAt ? ` · approved by ${item.approvedByName || "SRS approval"}` : ""}`}
      actions={<Link className="btn btn-ghost btn-sm" href={closeHref}>Close</Link>}
      className="item-detail"
    >
      <div className="row" style={{ justifyContent: "flex-start", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Badge value={item.status} /><OriginTag origin={item.origin} />
        {item.visibility === "internal" ? <span className="badge warn">internal note</span> : null}
        {item.reapprovalRequired ? <span className="badge bad">changed after approval — needs re-approval</span> : null}
      </div>
      {next.length ? (
        <div className="btn-group" style={{ marginBottom: 14 }}>
          {next.map((to) => (
            <form key={to} action={srsAction}>
              <Hidden values={{ intent: "item.transition", doc, back, item: item.id, version: item.version, to }} />
              <button className={to === "approved" || to === "verified" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"} type="submit">{to === "under_review" ? "Send for review" : to === "clarification_required" ? "Needs clarification" : `Mark ${to.replaceAll("_", " ")}`}</button>
            </form>
          ))}
        </div>
      ) : null}

      {caps.customer ? (
        <div className="stack">
          {item.description ? <p style={{ whiteSpace: "pre-wrap" }}>{item.description}</p> : null}
        </div>
      ) : (
        <ItemForm kind={item.kind} doc={doc} back={back} item={item} team={ws.team} caps={caps} locked={locked || !(meta && (caps.requirements || caps.edit))} />
      )}

      {meta.criteria ? (
        <>
          <h4 className="sub-head">Acceptance criteria</h4>
          {item.criteria.length === 0 ? <p className="meta">No acceptance criteria yet. Write them as Given / When / Then.</p> : (
            <ol className="ac-list">
              {item.criteria.map((c, i) => (
                <li key={c.id}>
                  <div><b>AC{i + 1}</b> <b>Given</b> {c.given} <b>When</b> {c.whenText} <b>Then</b> {c.thenText}</div>
                  <div className="row" style={{ justifyContent: "flex-start", gap: 8, flexWrap: "wrap" }}>
                    <Badge value={c.qaStatus === "na" ? "n/a" : c.qaStatus} />
                    {c.verifiedByName ? <span className="meta">{c.verifiedByName}{c.evidence ? ` · ${c.evidence}` : ""}</span> : null}
                    {caps.verify ? (
                      <form action={srsAction} className="inline-form">
                        <Hidden values={{ intent: "qa", doc, back, criterion: c.id, version: c.version }} />
                        <select name="status" defaultValue={c.qaStatus} aria-label="QA status">{QA_STATUSES.map((q) => <option key={q} value={q}>{QA_LABELS[q]}</option>)}</select>
                        <input name="evidence" placeholder="Evidence or test reference" aria-label="Evidence" defaultValue={c.evidence} />
                        <button className="btn btn-secondary btn-sm" type="submit">Record</button>
                      </form>
                    ) : null}
                    {caps.requirements && !locked ? (
                      <form action={srsAction}><Hidden values={{ intent: "criterion.remove", doc, back, criterion: c.id }} /><button className="btn btn-ghost btn-sm" type="submit">Remove</button></form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {caps.requirements && !locked ? (
            <form action={srsAction} className="ac-form">
              <Hidden values={{ intent: "criterion.add", doc, back, item: item.id }} />
              <label>Given<input name="given" required placeholder="a signed-in store manager" /></label>
              <label>When<input name="when" required placeholder="they approve a refund over $500" /></label>
              <label>Then<input name="then" required placeholder="the refund is issued and the customer is emailed" /></label>
              <button className="btn btn-secondary btn-sm" type="submit">Add criterion</button>
            </form>
          ) : null}
        </>
      ) : null}

      {!caps.customer && ["functional", "nonfunctional", "user_story", "deliverable"].includes(item.kind) ? (
        <>
          <h4 className="sub-head">Delivery links</h4>
          <p className="meta">{linkedTasks.length || linkedMilestones.length ? [...linkedTasks, ...linkedMilestones].map((l) => l.label).join(" · ") : "Not linked to tasks or milestones yet."}</p>
          <div className="btn-group">
            {caps.tasks && !linkedTasks.length ? <form action={srsAction}><Hidden values={{ intent: "convert", doc, back, item: item.id, target: "task" }} /><button className="btn btn-secondary btn-sm" type="submit">Create task</button></form> : null}
            {caps.milestones && !linkedMilestones.length ? <form action={srsAction}><Hidden values={{ intent: "convert", doc, back, item: item.id, target: "milestone" }} /><button className="btn btn-secondary btn-sm" type="submit">Create milestone</button></form> : null}
            {caps.requirements && ws.tasks.length ? (
              <form action={srsAction} className="inline-form">
                <Hidden values={{ intent: "link", doc, back, item: item.id, targetType: "task" }} />
                <select name="targetId" aria-label="Existing task">{ws.tasks.map((t) => <option key={t.id} value={t.id}>{t.code} {t.title}</option>)}</select>
                <button className="btn btn-ghost btn-sm" type="submit">Link task</button>
              </form>
            ) : null}
          </div>
        </>
      ) : null}

      <h4 className="sub-head">Discussion on {item.key}</h4>
      <Threads ws={ws} comments={thread} back={back} caps={caps} />
      <CommentForm ws={ws} back={back} caps={caps} targetType="item" targetKey={item.key} />

      {!caps.customer && item.revisions.length ? (
        <details className="advanced" style={{ marginTop: 14 }}>
          <summary>Revision history ({item.revisions.length})</summary>
          <ol className="timeline">
            {item.revisions.map((r) => (
              <li key={r.id}><span className="dot" /><div><strong>r{r.revision} · {r.changeSummary}</strong>{r.requiresReapproval ? <span className="badge bad" style={{ marginLeft: 6 }}>re-approval</span> : null}<div className="meta">{r.actorName} · {r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC{r.reason ? ` · ${r.reason}` : ""}</div></div></li>
            ))}
          </ol>
        </details>
      ) : null}
    </Panel>
  );
}

export function Threads({ ws, comments, back, caps }: { ws: Workspace; comments: Workspace["comments"]; back: string; caps: Caps }) {
  const top = comments.filter((c) => !c.parentId);
  if (!top.length) return <p className="meta">No comments yet.</p>;
  const files = new Map(ws.documents.map((d) => [d.id, d.fileName]));
  return (
    <div className="stack">
      {top.map((c) => {
        const replies = ws.comments.filter((r) => r.parentId === c.id);
        const attachments = (JSON.parse(c.attachmentIds || "[]") as string[]).filter((id) => files.has(id));
        return (
          <article key={c.id} className={c.visibility === "internal" ? "comment internal" : "comment"}>
            <div className="row">
              <strong>{c.authorName}{c.authorKind === "customer" ? <span className="meta"> · client</span> : null}</strong>
              <span className="btn-group">
                {c.kind === "clarification" ? <span className="badge warn">clarification</span> : null}
                {c.visibility === "internal" ? <span className="badge warn">internal</span> : null}
                <Badge value={c.status} />
              </span>
            </div>
            {c.targetKey ? <div className="meta">On {c.targetKey}</div> : null}
            <p style={{ whiteSpace: "pre-wrap" }}>{c.body}</p>
            {attachments.length ? <p className="meta">Attached: {attachments.map((id) => <a key={id} href={`/api/files/${id}`}>{files.get(id)} </a>)}</p> : null}
            <div className="meta">{c.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC{c.resolvedByName ? ` · resolved by ${c.resolvedByName}` : ""}</div>
            {replies.map((r) => (
              <div key={r.id} className="reply"><strong>{r.authorName}</strong>{r.authorKind === "customer" ? <span className="meta"> · client</span> : null}<p style={{ whiteSpace: "pre-wrap" }}>{r.body}</p><div className="meta">{r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</div></div>
            ))}
            {c.status !== "resolved" ? (
              <div className="row" style={{ alignItems: "flex-end", gap: 8 }}>
                <form action={srsAction} className="inline-form grow">
                  <Hidden values={{ intent: "comment", doc: ws.doc.id, back, parentId: c.id }} />
                  <input name="body" placeholder="Reply…" aria-label="Reply" required />
                  <button className="btn btn-secondary btn-sm" type="submit">Reply</button>
                </form>
                {caps.clarify || c.authorId === caps.userId ? (
                  <form action={srsAction}><Hidden values={{ intent: "comment.resolve", doc: ws.doc.id, back, comment: c.id }} /><button className="btn btn-ghost btn-sm" type="submit">Resolve</button></form>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export function CommentForm({ ws, back, caps, targetType, targetKey }: { ws: Workspace; back: string; caps: Caps; targetType?: string; targetKey?: string }) {
  const shareable = ws.documents.filter((d) => d.visibility === "customer" || !caps.customer);
  return (
    <form action={srsAction} className="form" style={{ marginTop: 12 }}>
      <Hidden values={{ intent: "comment", doc: ws.doc.id, back, ...(targetType ? { targetType } : {}), ...(targetKey ? { targetKey } : {}) }} />
      {!targetType ? (
        <label>About
          <select name="targetKey" defaultValue="">
            <option value="">The whole document</option>
            {ws.items.map((i) => <option key={i.id} value={i.key}>{i.key} · {i.title.slice(0, 60)}</option>)}
          </select>
          <input type="hidden" name="targetType" value="item" />
        </label>
      ) : null}
      <label>Comment<textarea name="body" rows={3} required placeholder="Use @Name to mention someone" /></label>
      <div className="form-grid">
        {caps.internal ? <label>Visibility<select name="visibility" defaultValue="shared"><option value="shared">Shared with client</option><option value="internal">Internal note</option></select></label> : null}
        {caps.clarify ? <label>Type<select name="kind" defaultValue="comment"><option value="comment">Comment</option><option value="clarification">Request clarification</option></select></label> : null}
        {shareable.length ? <label>Attach file<select name="attachments" defaultValue=""><option value="">None</option>{shareable.map((d) => <option key={d.id} value={d.id}>{d.fileName}</option>)}</select></label> : null}
      </div>
      <div className="form-actions"><button className="btn btn-primary btn-sm" type="submit">Post</button></div>
    </form>
  );
}
