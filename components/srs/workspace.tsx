import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { srsAction } from "@/app/srs-actions";
import { Badge, Drawer, Empty, PageHeader, Panel, Props, StatStrip, Tabs } from "@/components/ui";
import { DocPreview } from "@/components/srs/doc-preview";
import { SrsWizard } from "@/components/srs/wizard";
import { SignaturePad } from "@/components/srs/signature-pad";
import { CommentForm, ItemDetail, ItemTable, OriginTag, Threads, type Caps } from "@/components/srs/items";
import type { Actor } from "@/lib/actor";
import { can } from "@/lib/actor";
import { prisma } from "@/lib/db";
import { KINDS, NFR_CATEGORIES, ORIGINS, ORIGIN_LABELS, SRS_STATUS_LABELS, projectTypeLabel, type SrsStatus } from "@/lib/domain/srs/catalog";
import { isLocked, listProjectSrs, versionLabel } from "@/lib/domain/srs/core";
import { buildDocModel, loadDocInputs, type DocModel } from "@/lib/domain/srs/model";
import { compareVersions, getSrsWorkspace, traceability } from "@/lib/domain/srs/workflow";
import { loadProject } from "@/lib/domain/access";

type Query = { doc?: string; tab?: string; step?: string; item?: string; kind?: string; from?: string; to?: string; notice?: string; error?: string };

const STAFF_TABS: Array<[string, string]> = [
  ["overview", "Overview"],
  ["wizard", "Wizard"],
  ["document", "Sections"],
  ["requirements", "Requirements"],
  ["model", "Users & model"],
  ["scope", "Scope & changes"],
  ["trace", "Traceability & QA"],
  ["discussion", "Discussion"],
  ["versions", "Versions"],
  ["approval", "Approval"],
  ["preview", "Preview"],
];
const CLIENT_TABS: Array<[string, string]> = [
  ["overview", "Overview"],
  ["wizard", "Questions"],
  ["preview", "Document"],
  ["discussion", "Discussion"],
  ["changes", "Change requests"],
  ["versions", "Versions"],
  ["approval", "Approval"],
];
const MODEL_KINDS = ["role", "stakeholder", "use_case", "user_story", "business_rule", "workflow", "entity", "integration", "screen", "definition"];
const SCOPE_KINDS = ["scope_in", "scope_out", "scope_future", "assumption", "constraint", "dependency", "deliverable", "risk", "question"];

function Hidden({ values }: { values: Record<string, string | number> }) {
  return <>{Object.entries(values).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>;
}

const when = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—");

export async function SrsWorkspace({ actor, projectId, query }: { actor: Actor; projectId: string; query: Query }) {
  const customer = actor.kind === "customer";
  const root = `${customer ? "/portal" : ""}/projects/${projectId}/srs`;
  const project = await loadProject(prisma, actor, projectId);
  const docs = await listProjectSrs(actor, projectId);
  const projectHref = customer ? `/portal/projects/${projectId}` : `/projects/${projectId}`;
  const crumbs = [{ href: customer ? "/portal" : "/projects", label: customer ? "Projects" : "Projects" }, { href: projectHref, label: project.code }, { label: "Requirements (SRS)" }];

  if (!docs.length) {
    return (
      <main>
        <PageHeader crumbs={crumbs} title="Requirements specification" lede={customer ? "Your project team has not opened the requirements workspace yet." : "This project does not have an SRS yet. Projects created from now on get one automatically."} />
        {!customer && can(actor, "srs.edit") && !project.archivedAt ? (
          <Panel title="Start the SRS">
            <form action={srsAction} className="form">
              <Hidden values={{ intent: "create", projectId, mode: "continue", back: root }} />
              <p className="meta">Uses the {projectTypeLabel(project.projectType).toLowerCase()} template and prefills from the CRM and project record.</p>
              <div className="form-actions"><button className="btn btn-primary" type="submit">Create SRS draft</button></div>
            </form>
          </Panel>
        ) : <Empty title="Nothing here yet" body="You will be notified when the requirements are ready for your input." />}
      </main>
    );
  }

  const selected = docs.find((d) => d.id === query.doc) ?? docs.find((d) => !["archived", "superseded"].includes(d.status)) ?? docs[docs.length - 1];
  const ws = await getSrsWorkspace(actor, selected.id);
  const { doc } = ws;
  const tabs = customer ? CLIENT_TABS : STAFF_TABS;
  const tab = tabs.find(([key]) => key === query.tab)?.[0] ?? "overview";
  const base = `${root}?doc=${doc.id}`;
  const here = `${base}&tab=${tab}${query.kind ? `&kind=${query.kind}` : ""}`;
  const locked = isLocked(doc.status) || Boolean(project.archivedAt);
  const caps: Caps = {
    userId: actor.userId,
    customer,
    edit: !customer && can(actor, "srs.edit"),
    requirements: !customer && can(actor, "srs.requirements"),
    approve: !customer && can(actor, "srs.approve_requirements"),
    verify: !customer && can(actor, "srs.verify"),
    clarify: can(actor, "srs.clarify"),
    internal: ws.internal,
    tasks: !customer && can(actor, "tasks.create"),
    milestones: !customer && can(actor, "projects.edit"),
  };
  const candidate = ws.versions.find((v) => v.status === "in_approval");
  const approved = ws.versions.find((v) => v.id === doc.approvedVersionId);
  const openClarifications = ws.comments.filter((c) => !c.parentId && c.kind === "clarification" && c.status !== "resolved");
  const changeCount = ws.changes.filter((c) => !["closed", "rejected", "approved", "implemented", "verified"].includes(c.status)).length;
  const item = query.item ? ws.items.find((i) => i.id === query.item) : undefined;
  const itemHref = (id: string) => `${here}&item=${id}`;
  const signedByMe = candidate ? ws.signatures.some((s) => s.versionId === candidate.id && s.signerId === actor.userId) : false;
  const canSign = Boolean(candidate) && !signedByMe && (customer ? can(actor, "srs.sign") : can(actor, "srs.approve"));
  const canDraft = !customer && can(actor, "srs.download_draft");
  const canApproved = can(actor, "srs.download_approved");
  const download = (ref: string, format: string) => `/api/srs/${doc.id}/download?ref=${ref}&format=${format}`;

  const tabCount: Record<string, number | null> = {
    requirements: ws.items.filter((i) => i.kind === "functional" || i.kind === "nonfunctional").length,
    discussion: openClarifications.length || null,
    changes: changeCount || null,
    scope: changeCount || null,
    approval: candidate ? 1 : null,
  };

  return (
    <main>
      <PageHeader
        crumbs={crumbs}
        title={doc.code}
        badges={<><Badge value={doc.status} />{doc.clientAccess ? <span className="badge info">client access on</span> : !customer ? <span className="badge">internal only</span> : null}</>}
        facts={
          <>
            <span>Version <strong>{versionLabel(doc)}</strong>{approved ? <> · approved <strong>v{approved.label}</strong></> : null}</span>
            <span>{projectTypeLabel(doc.projectType)}</span>
            {!customer ? <span>Template <strong>{ws.template.name} v{ws.template.version}</strong>{ws.template.latest > ws.template.version ? " (newer available)" : ""}</span> : null}
          </>
        }
        action={
          <>
            {canApproved && approved ? <a className="btn btn-primary" href={download("approved", "pdf")}><Download size={15} aria-hidden="true" /> Approved PDF</a> : null}
            {canDraft ? <a className="btn btn-secondary" href={download("latest", "pdf")}><FileText size={15} aria-hidden="true" /> Draft PDF</a> : null}
            {ws.transitions.length && !project.archivedAt ? (
              <Drawer label={customer ? "Respond" : "Move status"} title="Change SRS status" primary={!approved}>
                <form action={srsAction} className="form">
                  <Hidden values={{ intent: "transition", doc: doc.id, back: here, version: doc.version }} />
                  <label>Move to<select name="to">{ws.transitions.map((t) => <option key={t} value={t}>{SRS_STATUS_LABELS[t as SrsStatus] ?? t}</option>)}</select></label>
                  <label>Note<textarea name="note" rows={3} placeholder="Required when requesting changes" /></label>
                  <p className="help">Sending for client review publishes a snapshot to the client. Requesting approval locks the content and creates the version that signers approve.</p>
                  <div className="form-actions"><button className="btn btn-primary" type="submit">Update</button></div>
                </form>
              </Drawer>
            ) : null}
          </>
        }
      />
      {query.error ? <p className="alert bad" role="alert">{query.error}</p> : null}
      {query.notice ? <p className="alert good" role="status">{query.notice}</p> : null}
      {doc.status === "approval_pending" ? <p className="alert warn">Version {candidate?.label} is out for approval. Content is locked until it is approved or the approval round is cancelled.</p> : null}
      {doc.status === "approved" ? <p className="alert good">Version {approved?.label} is the approved baseline. It cannot be edited — {customer ? "submit a change request for anything new." : "open a revision or approve a change request to change it."}</p> : null}
      {project.archivedAt ? <p className="alert warn">This project is archived. The SRS is read-only.</p> : null}
      {docs.length > 1 ? (
        <nav className="seg" aria-label="SRS documents" style={{ marginBottom: 12 }}>
          {docs.map((d) => <Link key={d.id} href={`${root}?doc=${d.id}`} aria-current={d.id === doc.id ? "page" : undefined}>{d.code} · {SRS_STATUS_LABELS[d.status as SrsStatus]}</Link>)}
        </nav>
      ) : null}

      <Tabs label="SRS sections" items={tabs.map(([key, label]) => ({ href: `${base}&tab=${key}`, label, current: tab === key, count: tabCount[key] ?? null, alert: key === "discussion" || key === "changes" }))} />

      {tab === "overview" ? <Overview ws={ws} caps={caps} actor={actor} here={here} base={base} locked={locked} download={download} canDraft={canDraft} canApproved={canApproved} candidate={candidate} approved={approved} openClarifications={openClarifications.length} canSign={canSign} projectId={projectId} root={root} /> : null}

      {tab === "wizard" ? (
        <SrsWizard
          docId={doc.id}
          steps={ws.config.steps}
          answers={Object.fromEntries(ws.answers.map((a) => [a.questionKey, { value: a.value, version: a.version, origin: a.origin, by: a.updatedByName, at: a.updatedAt.toISOString() }]))}
          stepKey={query.step ?? ws.config.steps[0]?.key}
          editable={!locked && (customer ? can(actor, "srs.respond") && ["draft", "client_input_required", "client_review", "changes_requested"].includes(doc.status) : can(actor, "srs.edit"))}
          customer={customer}
          baseHref={base}
          lockedReason={locked ? "This version is locked. Answers can change again once a revision is opened." : customer && !["draft", "client_input_required", "client_review", "changes_requested"].includes(doc.status) ? "The team is reviewing your answers. You can still comment in Discussion." : undefined}
        />
      ) : null}

      {tab === "document" && !customer ? <Sections ws={ws} here={here} locked={locked} caps={caps} /> : null}

      {tab === "requirements" && !customer ? (
        <div className="page-stack">
          {item ? <ItemDetail item={item} ws={ws} back={`${here}&item=${item.id}`} closeHref={here} caps={caps} locked={locked} /> : null}
          {caps.requirements && !locked && ws.answers.length ? (
            <Panel title="Structure the wizard answers" description="Each line of a list answer becomes a draft item labelled with its source. Nothing is approved automatically.">
              <form action={srsAction}><Hidden values={{ intent: "generate", doc: doc.id, back: here }} /><button className="btn btn-secondary btn-sm" type="submit">Create draft items from answers</button></form>
            </Panel>
          ) : null}
          <ItemTable kind="functional" items={ws.items} href={itemHref} doc={doc.id} back={here} team={ws.team} caps={caps} locked={locked} comments={ws.comments} />
          <NfrCoverage ws={ws} here={here} locked={locked} caps={caps} />
          <ItemTable kind="nonfunctional" items={ws.items} href={itemHref} doc={doc.id} back={here} team={ws.team} caps={caps} locked={locked} comments={ws.comments} />
        </div>
      ) : null}

      {tab === "model" && !customer ? (
        <div className="page-stack">
          <nav className="seg" aria-label="Item types">
            {MODEL_KINDS.map((k) => <Link key={k} href={`${base}&tab=model&kind=${k}`} aria-current={(query.kind ?? "role") === k ? "page" : undefined}>{KINDS[k].plural} <span className="tab-count">{ws.items.filter((i) => i.kind === k).length}</span></Link>)}
          </nav>
          {item ? <ItemDetail item={item} ws={ws} back={`${here}&item=${item.id}`} closeHref={here} caps={caps} locked={locked} /> : null}
          <ItemTable kind={MODEL_KINDS.includes(query.kind ?? "") ? query.kind! : "role"} items={ws.items} href={itemHref} doc={doc.id} back={here} team={ws.team} caps={caps} locked={locked} comments={ws.comments} />
        </div>
      ) : null}

      {tab === "scope" && !customer ? (
        <div className="page-stack">
          <nav className="seg" aria-label="Scope items">
            {SCOPE_KINDS.map((k) => <Link key={k} href={`${base}&tab=scope&kind=${k}`} aria-current={(query.kind ?? "scope_in") === k ? "page" : undefined}>{KINDS[k].plural} <span className="tab-count">{ws.items.filter((i) => i.kind === k).length}</span></Link>)}
          </nav>
          {item ? <ItemDetail item={item} ws={ws} back={`${here}&item=${item.id}`} closeHref={here} caps={caps} locked={locked} /> : null}
          <ItemTable kind={SCOPE_KINDS.includes(query.kind ?? "") ? query.kind! : "scope_in"} items={ws.items} href={itemHref} doc={doc.id} back={here} team={ws.team} caps={caps} locked={locked} comments={ws.comments} />
          <Changes ws={ws} actor={actor} here={here} />
        </div>
      ) : null}

      {tab === "changes" && customer ? <Changes ws={ws} actor={actor} here={here} /> : null}

      {tab === "trace" && !customer ? <Trace actor={actor} docId={doc.id} ws={ws} here={here} caps={caps} /> : null}

      {tab === "discussion" ? (
        <div className="page-stack">
          {item ? <ItemDetail item={item} ws={ws} back={`${here}&item=${item.id}`} closeHref={here} caps={caps} locked={locked} /> : null}
          <Panel title="Discussion" description={customer ? "Questions and comments for the Elec Nova team." : "Shared threads are visible to the client. Internal notes never are."}>
            <CommentForm ws={ws} back={here} caps={caps} />
            <div style={{ marginTop: 16 }}><Threads ws={ws} comments={ws.comments} back={here} caps={caps} /></div>
          </Panel>
        </div>
      ) : null}

      {tab === "versions" ? <Versions actor={actor} ws={ws} base={base} query={query} download={download} canDraft={canDraft} canApproved={canApproved} /> : null}

      {tab === "approval" ? <Approval ws={ws} here={here} candidate={candidate} canSign={canSign} signedByMe={signedByMe} actor={actor} /> : null}

      {tab === "preview" ? <Preview docId={doc.id} status={doc.status} download={download} canDraft={canDraft} customer={customer} /> : null}
    </main>
  );
}

type WS = Awaited<ReturnType<typeof getSrsWorkspace>>;
type Version = WS["versions"][number];

function Overview({ ws, caps, actor, here, base, locked, download, canDraft, canApproved, candidate, approved, openClarifications, canSign, projectId, root }: { ws: WS; caps: Caps; actor: Actor; here: string; base: string; locked: boolean; download: (r: string, f: string) => string; canDraft: boolean; canApproved: boolean; candidate?: Version; approved?: Version; openClarifications: number; canSign: boolean; projectId: string; root: string }) {
  const { doc, completeness: check } = ws;
  const signatures = candidate ? ws.signatures.filter((s) => s.versionId === candidate.id && s.decision === "approved") : [];
  const needed = ws.config.approval.clientSigners + ws.config.approval.companySigners;
  const customer = caps.customer;
  const shared = ws.versions.find((v) => v.clientVisible);
  const actions: Array<[string, string]> = [];
  if (canSign) actions.push(["Your approval is requested", `${base}&tab=approval`]);
  if (customer && doc.status === "client_input_required") actions.push(["Answer the open questions", `${base}&tab=wizard`]);
  if (openClarifications) actions.push([`${openClarifications} clarification${openClarifications === 1 ? "" : "s"} open`, `${base}&tab=discussion`]);
  const toAssess = ws.changes.filter((c) => c.status === "requested").length;
  if (!customer && toAssess) actions.push([`${toAssess} change request${toAssess === 1 ? "" : "s"} to assess`, `${base}&tab=scope`]);
  const reapprove = ws.items.filter((i) => i.reapprovalRequired).length;
  if (!customer && reapprove) actions.push([`${reapprove} item${reapprove === 1 ? "" : "s"} need re-approval`, `${base}&tab=requirements`]);
  return (
    <div className="dash">
      <div className="dash-col">
        <StatStrip
          items={[
            { label: "Status", value: SRS_STATUS_LABELS[doc.status as SrsStatus] },
            { label: "Answers", value: `${check.stats.answered}/${check.stats.questions}`, hint: "required questions", href: `${base}&tab=wizard` },
            ...(customer ? [] : [{ label: "Blockers", value: check.blockers.length, hint: check.blockers.length ? "before approval" : "ready for approval", tone: (check.blockers.length ? "now" : "") as "now" | "" }]),
            { label: "Approvals", value: candidate ? `${signatures.length}/${needed}` : approved ? "Approved" : "—", hint: candidate ? `v${candidate.label}` : undefined, href: `${base}&tab=approval` },
            { label: "Items", value: check.stats.items, hint: "in the client document" },
          ]}
        />
        {!customer ? (
          <Panel title="Completeness" description={check.blockers.length ? "Each item below must be resolved before the SRS can go for approval." : "No blockers. The SRS can be submitted for approval."} flush>
            {check.blockers.length ? (
              <ul className="rows">
                {check.blockers.map((b) => <li key={b.code}><div className="grow">{b.message}</div><Link className="btn btn-ghost btn-sm" href={`${base}&tab=${b.tab}`}>Fix</Link></li>)}
              </ul>
            ) : <p className="meta" style={{ padding: "14px 16px" }}>All mandatory sections, questions, requirement types and quality categories are covered.</p>}
            {check.warnings.length ? (
              <>
                <h4 className="sub-head" style={{ padding: "0 16px" }}>Worth checking</h4>
                <ul className="rows">{check.warnings.map((w) => <li key={w.code}><div className="grow meta">{w.message}</div><Link className="btn btn-ghost btn-sm" href={w.tab === "overview" ? `/projects/${projectId}` : `${base}&tab=${w.tab}`}>Open</Link></li>)}</ul>
              </>
            ) : null}
          </Panel>
        ) : (
          <Panel title="What happens next">
            <ol className="steps-list">
              <li className={["draft", "client_input_required"].includes(doc.status) ? "now" : "done"}>Answer the questions so we understand your needs.</li>
              <li className={["internal_review", "client_review", "changes_requested"].includes(doc.status) ? "now" : ["approval_pending", "approved"].includes(doc.status) ? "done" : ""}>Review the draft specification and ask for clarifications.</li>
              <li className={doc.status === "approval_pending" ? "now" : doc.status === "approved" ? "done" : ""}>Approve the final version with your signature.</li>
              <li className={doc.status === "approved" ? "now" : ""}>Track delivery against the approved requirements. New ideas become change requests.</li>
            </ol>
          </Panel>
        )}
      </div>
      <div className="dash-col">
        <Panel title="Pending actions" flush>
          {actions.length ? <ul className="rows">{actions.map(([label, href]) => <li key={label}><div className="grow"><strong>{label}</strong></div><Link className="btn btn-secondary btn-sm" href={href}>Open</Link></li>)}</ul> : <p className="meta" style={{ padding: "14px 16px" }}>Nothing is waiting on you.</p>}
        </Panel>
        <Panel title="Downloads" flush>
          <ul className="rows">
            {approved && canApproved ? <li><div className="grow"><strong>Approved v{approved.label}</strong><span className="meta">Signed baseline · stored unchanged</span></div><a className="btn btn-secondary btn-sm" href={download("approved", "pdf")}>PDF</a><a className="btn btn-secondary btn-sm" href={download("approved", "docx")}>DOCX</a></li> : null}
            {canDraft ? <li><div className="grow"><strong>Current draft {versionLabel(doc)}</strong><span className="meta">Watermarked DRAFT</span></div><a className="btn btn-secondary btn-sm" href={download("latest", "pdf")}>PDF</a><a className="btn btn-secondary btn-sm" href={download("latest", "docx")}>DOCX</a></li> : null}
            {customer && shared && shared.id !== approved?.id ? <li><div className="grow"><strong>Review copy v{shared.label}</strong><span className="meta">Shared {when(shared.publishedAt)} · not yet approved</span></div><a className="btn btn-secondary btn-sm" href={download(shared.id, "pdf")}>PDF</a><a className="btn btn-secondary btn-sm" href={download(shared.id, "docx")}>DOCX</a></li> : null}
            {!approved && !canDraft && !(customer && shared) ? <li><div className="grow meta">Files appear here once a version is shared with you.</div></li> : null}
          </ul>
        </Panel>
        {!customer ? (
          <Panel title="Settings">
            <Props items={[["Template", `${ws.template.name} v${ws.template.version}`], ["Created", `${when(doc.createdAt)} by ${doc.createdByName}`], ["Classification", doc.confidentiality]]} />
            {can(actor, "srs.publish") ? (
              <form action={srsAction} className="inline-form" style={{ marginTop: 12 }}>
                <Hidden values={{ intent: "settings", doc: doc.id, back: here, version: doc.version, clientAccess: doc.clientAccess ? "off" : "on" }} />
                <span className="meta grow">{doc.clientAccess ? "The client can answer questions, comment, review and sign." : "Only your team can see this SRS."}</span>
                <button className="btn btn-secondary btn-sm" type="submit">{doc.clientAccess ? "Turn off client access" : "Give client access"}</button>
              </form>
            ) : null}
            <div className="btn-group" style={{ marginTop: 12 }}>
              {doc.status === "approved" && can(actor, "srs.versions") ? (
                <Drawer label="Open revision" title="Revise the approved SRS">
                  <form action={srsAction} className="form">
                    <Hidden values={{ intent: "revision", doc: doc.id, back: here, version: doc.version }} />
                    <p className="help">The approved version stays exactly as signed. A new draft {doc.major}.1 opens; changed items are flagged for re-approval.</p>
                    <label>Reason<textarea name="reason" required minLength={5} rows={3} /></label>
                    <div className="form-actions"><button className="btn btn-primary" type="submit">Open revision</button></div>
                  </form>
                </Drawer>
              ) : null}
              {can(actor, "srs.edit") && !locked ? (
                <Drawer label="Separate SRS" title="Create a separate SRS">
                  <form action={srsAction} className="form">
                    <Hidden values={{ intent: "create", projectId, mode: "separate", back: root }} />
                    <p className="help">Only for a genuinely separate scope, such as a second product. To change this SRS, keep editing it or open a revision.</p>
                    <label>Why is a separate SRS needed?<textarea name="reason" required minLength={5} rows={3} /></label>
                    <div className="form-actions"><button className="btn btn-primary" type="submit">Create separate SRS</button></div>
                  </form>
                </Drawer>
              ) : null}
            </div>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

async function Sections({ ws, here, locked, caps }: { ws: WS; here: string; locked: boolean; caps: Caps }) {
  const inputs = await loadDocInputs(prisma, ws.doc.id);
  const model = buildDocModel(inputs);
  const built = new Map(model.groups.flatMap((g) => g.sections.map((s) => [s.key, s] as const)));
  const overrides = JSON.parse(ws.doc.overrides || "{}") as Record<string, string>;
  const configs = new Map(ws.config.sections.map((s) => [s.key, s]));
  return (
    <Panel title="Document sections" description="Narrative text for each section. Structured items and wizard answers are added automatically in the document." flush>
      <div className="section-list">
        {ws.sections.map((section) => {
          const view = built.get(section.key);
          const filled = view && view.blocks.some((b) => b.type !== "notice");
          const config = configs.get(section.key);
          const prefill = view?.blocks.find((b) => b.type === "text" && b.caption?.startsWith("From") || (b.type === "text" && b.caption === "Adjusted from the CRM record"));
          return (
            <details key={section.id} className="section-item">
              <summary>
                <span className="num">{view?.number ?? "—"}</span>
                <strong className="grow">{section.title}</strong>
                {section.required ? <span className="badge info">required</span> : null}
                {section.visibility === "internal" ? <span className="badge warn">internal</span> : null}
                {!section.applicable ? <span className="badge">not applicable</span> : filled ? <span className="badge good">has content</span> : <span className="badge warn">empty</span>}
              </summary>
              <div className="section-body">
                {config?.guidance ? <p className="help">{config.guidance}</p> : null}
                {config?.prefill && ["summary", "objectives", "scope", "opportunity"].includes(config.prefill) ? (
                  <div className="prefill">
                    <div className="row"><span className="meta">{overrides[section.key] ? "Adjusted text (overrides the CRM record)" : "Prefilled from the CRM / project record"}</span></div>
                    <p style={{ whiteSpace: "pre-wrap" }}>{prefill && prefill.type === "text" ? prefill.text : <span className="meta">The source record is empty.</span>}</p>
                    {caps.edit && !locked ? (
                      <details>
                        <summary className="btn btn-ghost btn-sm">Adjust for this SRS</summary>
                        <form action={srsAction} className="form">
                          <Hidden values={{ intent: "override", doc: ws.doc.id, back: here, key: section.key, version: ws.doc.version }} />
                          <textarea name="text" rows={4} defaultValue={overrides[section.key] ?? (prefill && prefill.type === "text" ? prefill.text : "")} />
                          <div className="form-actions">
                            {overrides[section.key] ? <button className="btn btn-ghost btn-sm" type="submit" name="clear" value="1">Use CRM text again</button> : null}
                            <button className="btn btn-secondary btn-sm" type="submit">Save override</button>
                          </div>
                        </form>
                      </details>
                    ) : null}
                  </div>
                ) : null}
                <form action={srsAction} className="form">
                  <Hidden values={{ intent: "section", doc: ws.doc.id, back: here, key: section.key, version: section.version }} />
                  <label>Section text<textarea name="content" rows={5} defaultValue={section.content} disabled={locked || !caps.edit} /></label>
                  <div className="form-grid">
                    <label>Source<select name="origin" defaultValue={section.origin} disabled={locked || !caps.edit}>{ORIGINS.map((o) => <option key={o} value={o}>{ORIGIN_LABELS[o]}</option>)}</select></label>
                    <label>Applies to this project<select name="applicable" defaultValue={section.applicable ? "yes" : "no"} disabled={locked || !caps.edit}><option value="yes">Yes</option><option value="no">No — not applicable</option></select></label>
                    {!section.required && caps.internal ? <label>Visibility<select name="visibility" defaultValue={section.visibility} disabled={locked || !caps.edit}><option value="shared">Client document</option><option value="internal">Internal only</option></select></label> : null}
                  </div>
                  <label>Reason if not applicable<input name="naReason" defaultValue={section.naReason} disabled={locked || !caps.edit} /></label>
                  {!locked && caps.edit ? <div className="form-actions"><span className="meta grow">Last edited by {section.updatedByName || "—"}</span><button className="btn btn-primary btn-sm" type="submit">Save section</button></div> : null}
                </form>
              </div>
            </details>
          );
        })}
      </div>
    </Panel>
  );
}

function NfrCoverage({ ws, here, locked, caps }: { ws: WS; here: string; locked: boolean; caps: Caps }) {
  const na = JSON.parse(ws.doc.nfrNotApplicable || "{}") as Record<string, string>;
  return (
    <Panel title="Quality attribute coverage" description="Every category needs at least one requirement, or a reason it does not apply." flush>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Category</th><th>Coverage</th><th>Not applicable?</th></tr></thead>
          <tbody>
            {NFR_CATEGORIES.map(([key, label]) => {
              const count = ws.items.filter((i) => i.kind === "nonfunctional" && (JSON.parse(i.data || "{}") as { category?: string }).category === key).length;
              return (
                <tr key={key}>
                  <td><strong>{label}</strong></td>
                  <td>{na[key] ? <span className="meta">N/A — {na[key]}</span> : count ? <span className="badge good">{count} requirement{count === 1 ? "" : "s"}</span> : <span className="badge warn">missing</span>}</td>
                  <td>
                    {caps.requirements && !locked && !count ? (
                      <form action={srsAction} className="inline-form">
                        <Hidden values={{ intent: "nfr", doc: ws.doc.id, back: here, category: key, version: ws.doc.version, applicable: na[key] ? "yes" : "no" }} />
                        {!na[key] ? <input name="reason" placeholder="Reason it does not apply" aria-label={`Reason ${label} does not apply`} required minLength={5} /> : null}
                        <button className="btn btn-ghost btn-sm" type="submit">{na[key] ? "Make applicable" : "Mark N/A"}</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Changes({ ws, actor, here }: { ws: WS; actor: Actor; here: string }) {
  const customer = actor.kind === "customer";
  const canCreate = can(actor, "changes.create") && !ws.project.archivedAt;
  return (
    <Panel
      title="Change requests"
      description="After approval, new needs are classified as in scope, a clarification, a defect, or a change request. Approved change requests open a new SRS version."
      flush
      actions={canCreate ? (
        <Drawer label="New request" title="Request a change" wide>
          <form action={srsAction} className="form">
            <Hidden values={{ intent: "change.create", doc: ws.doc.id, back: here }} />
            <label>Title<input name="title" required minLength={3} /></label>
            <label>What do you need, and why?<textarea name="reason" rows={4} required minLength={5} /></label>
            <label>Affected requirement IDs<input name="keys" placeholder="FR-001, FR-004" /></label>
            {!customer ? (
              <>
                <label>Classification<select name="classification" defaultValue="change_request"><option value="change_request">Change request</option><option value="in_scope">Already in scope</option><option value="clarification">Clarification</option><option value="defect">Defect</option></select></label>
                <ImpactFields />
              </>
            ) : <p className="help">The Elec Nova team will assess the impact on scope, timeline and cost before anything changes.</p>}
            <div className="form-actions"><button className="btn btn-primary" type="submit">Submit</button></div>
          </form>
        </Drawer>
      ) : null}
    >
      {ws.changes.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No change requests.</p> : (
        <div className="rows">
          {ws.changes.map((c) => {
            const keys = JSON.parse(c.affectedItemKeys || "[]") as string[];
            return (
              <div key={c.id} className="change-row">
                <div className="grow">
                  <strong>{c.code} · {c.title}</strong>
                  <span className="meta">{c.requesterName} · {c.reason}</span>
                  <span className="meta">{[c.classification !== "unclassified" ? c.classification.replaceAll("_", " ") : "awaiting assessment", keys.length ? `affects ${keys.join(", ")}` : "", c.timelineImpact && `timeline ${c.timelineImpact}`, c.effortImpact && `effort ${c.effortImpact}`, c.commercialImpact && `cost ${c.commercialImpact}`].filter(Boolean).join(" · ")}</span>
                  {c.outcome ? <span className="meta">Outcome: {c.outcome}</span> : null}
                </div>
                <Badge value={c.status} />
                {!customer && can(actor, "changes.create") && ["requested", "under_review"].includes(c.status) ? (
                  <Drawer label="Assess" title={`Assess ${c.code}`} wide>
                    <form action={srsAction} className="form">
                      <Hidden values={{ intent: "change.assess", doc: ws.doc.id, back: here, change: c.id, version: c.version }} />
                      <label>Classification<select name="classification" defaultValue={c.classification === "unclassified" ? "change_request" : c.classification}><option value="change_request">Change request</option><option value="in_scope">Already in scope</option><option value="clarification">Clarification</option><option value="defect">Defect</option></select></label>
                      <ImpactFields defaults={c} />
                      <label>Note (required when it is not a change request)<textarea name="note" rows={2} /></label>
                      <div className="form-actions"><button className="btn btn-primary" type="submit">Save assessment</button></div>
                    </form>
                  </Drawer>
                ) : null}
                {!customer && can(actor, "changes.approve") && c.status === "under_review" && c.classification === "change_request" ? (
                  <Drawer label="Decide" title={`Decide ${c.code}`}>
                    <form action={srsAction} className="form">
                      <Hidden values={{ intent: "change.decide", doc: ws.doc.id, back: here, change: c.id, version: c.version }} />
                      <label>Decision<select name="decision"><option value="approved">Approve — open a new SRS version</option><option value="rejected">Reject — keep on record</option></select></label>
                      <label>Reason<textarea name="note" rows={3} required minLength={5} /></label>
                      <div className="form-actions"><button className="btn btn-primary" type="submit">Record decision</button></div>
                    </form>
                  </Drawer>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function ImpactFields({ defaults }: { defaults?: { scopeImpact: string; timelineImpact: string; effortImpact: string; commercialImpact: string; risks: string; estimatedMinutes: number } }) {
  return (
    <>
      <label>Scope impact<textarea name="scopeImpact" rows={2} defaultValue={defaults?.scopeImpact} /></label>
      <div className="form-grid">
        <label>Timeline impact<input name="timelineImpact" defaultValue={defaults?.timelineImpact} placeholder="+1 week" /></label>
        <label>Effort impact<input name="effortImpact" defaultValue={defaults?.effortImpact} placeholder="16 hours" /></label>
        <label>Estimated hours<input name="hours" type="number" min={0} step="0.5" defaultValue={defaults ? defaults.estimatedMinutes / 60 : undefined} /></label>
        <label>Commercial impact<input name="commercialImpact" defaultValue={defaults?.commercialImpact} placeholder="Fixed fee $2,400" /></label>
      </div>
      <label>Risks<textarea name="risks" rows={2} defaultValue={defaults?.risks} /></label>
    </>
  );
}

async function Trace({ actor, docId, ws, here, caps }: { actor: Actor; docId: string; ws: WS; here: string; caps: Caps }) {
  const rows = await traceability(actor, docId);
  const criteria = ws.items.filter((i) => i.criteria.length);
  const all = criteria.flatMap((i) => i.criteria);
  const count = (s: string) => all.filter((c) => c.qaStatus === s).length;
  return (
    <div className="page-stack">
      <StatStrip items={[{ label: "Criteria", value: all.length }, { label: "Passed", value: count("passed") }, { label: "Failed", value: count("failed"), tone: count("failed") ? "now" : "" }, { label: "Blocked", value: count("blocked") }, { label: "Pending", value: count("pending") }]} />
      <Panel title="Traceability matrix" description="Each requirement linked to stories, delivery work, tests, change requests, discussion and approval." flush>
        {rows.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No requirements yet.</p> : (
          <div className="table-wrap">
            <table className="trace">
              <thead><tr><th>ID</th><th>Requirement</th><th>Status</th><th>Use cases / stories</th><th>Tasks</th><th>Milestones</th><th>Tests</th><th>Changes</th><th>Comments</th><th>Approval</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap"><Link href={`${here.replace("tab=trace", "tab=requirements")}&item=${r.id}`}><strong>{r.key}</strong></Link></td>
                    <td>{r.title}{r.priority === "must" ? <span className="badge info" style={{ marginLeft: 6 }}>must</span> : null}</td>
                    <td><Badge value={r.status} /></td>
                    <td className="meta">{r.stories.join(", ") || "—"}</td>
                    <td className="meta">{r.tasks.join(", ") || <span className={r.priority === "must" ? "warn-text" : undefined}>—</span>}</td>
                    <td className="meta">{r.milestones.join(", ") || "—"}</td>
                    <td className="meta nowrap">{r.tests.total ? `${r.tests.passed}/${r.tests.total}${r.tests.failed ? ` · ${r.tests.failed} failed` : ""}` : "none"}</td>
                    <td className="meta">{r.changes.join(", ") || "—"}</td>
                    <td className="meta">{r.comments || "—"}</td>
                    <td className="meta">{r.approval}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Acceptance testing" description={caps.verify ? "Record QA results per criterion. Requirements are verified once every criterion passed or is N/A." : "QA results per criterion."} flush>
        {criteria.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No acceptance criteria yet.</p> : (
          <div className="rows">
            {criteria.map((i) => (
              <div key={i.id}>
                <div className="grow">
                  <strong>{i.key} · {i.title}</strong>
                  {i.criteria.map((c, n) => <span key={c.id} className="meta">AC{n + 1}: Given {c.given} · When {c.whenText} · Then {c.thenText} — <b>{c.qaStatus === "na" ? "N/A" : c.qaStatus}</b>{c.evidence ? ` (${c.evidence})` : ""}</span>)}
                </div>
                <Link className="btn btn-ghost btn-sm" href={`${here.replace("tab=trace", "tab=requirements")}&item=${i.id}`}>Record results</Link>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

async function Versions({ actor, ws, base, query, download, canDraft, canApproved }: { actor: Actor; ws: WS; base: string; query: Query; download: (r: string, f: string) => string; canDraft: boolean; canApproved: boolean }) {
  const customer = actor.kind === "customer";
  const diff = query.from ? await compareVersions(actor, ws.doc.id, query.from, (query.to as string) || "live").catch(() => null) : null;
  return (
    <div className="page-stack">
      <Panel title="Version history" description="Every snapshot is stored unchanged. Superseded versions stay available for reference." flush>
        {ws.versions.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>{customer ? "No version has been shared with you yet." : "No snapshots yet. One is created when the SRS goes to client review or approval."}</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Version</th><th>Type</th><th>Status</th><th>Created</th><th>Fingerprint</th><th>Note</th><th>Files</th></tr></thead>
              <tbody>
                {ws.versions.map((v) => {
                  const approvedLike = v.status === "approved" || v.status === "superseded";
                  const allowed = approvedLike ? canApproved : customer ? v.clientVisible : canDraft;
                  return (
                    <tr key={v.id}>
                      <td><strong>v{v.label}</strong></td>
                      <td className="meta">{v.kind === "candidate" ? "Approval candidate" : "Review snapshot"}{v.clientVisible && !customer ? " · shared" : ""}</td>
                      <td><Badge value={v.status === "in_approval" ? "pending approval" : v.status} /></td>
                      <td className="meta nowrap">{when(v.createdAt)}<br />{v.createdByName}</td>
                      <td className="mono meta">{v.hash.slice(0, 12)}</td>
                      <td className="meta">{v.note}</td>
                      <td className="nowrap">{allowed ? <><a className="btn btn-ghost btn-sm" href={download(v.id, "pdf")}>PDF</a><a className="btn btn-ghost btn-sm" href={download(v.id, "docx")}>DOCX</a></> : <span className="meta">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {ws.versions.length ? (
        <Panel title="Compare versions">
          <form method="get" className="inline-form">
            <input type="hidden" name="doc" value={ws.doc.id} />
            <input type="hidden" name="tab" value="versions" />
            <label>From<select name="from" defaultValue={query.from ?? ws.versions.at(-1)?.id}>{ws.versions.map((v) => <option key={v.id} value={v.id}>v{v.label} ({v.status.replaceAll("_", " ")})</option>)}</select></label>
            <label>To<select name="to" defaultValue={query.to ?? (customer ? ws.versions[0]?.id : "live")}>{!customer ? <option value="live">Current draft</option> : null}{ws.versions.map((v) => <option key={v.id} value={v.id}>v{v.label} ({v.status.replaceAll("_", " ")})</option>)}</select></label>
            <button className="btn btn-secondary btn-sm" type="submit">Compare</button>
          </form>
          {diff ? (
            diff.entries.length === 0 ? <p className="meta" style={{ marginTop: 12 }}>No differences between v{diff.from} and {diff.to}.</p> : (
              <div className="diff-list">
                <p className="meta">{diff.entries.length} change{diff.entries.length === 1 ? "" : "s"} from v{diff.from} to {diff.to}</p>
                {diff.entries.map((e) => (
                  <div key={`${e.area}-${e.key}`} className={`diff ${e.change}`}>
                    <div className="row"><strong>{e.area === "Item" ? e.key : e.title}{e.area === "Item" ? ` · ${e.title}` : ""}</strong><span className="badge">{e.change}</span></div>
                    {e.before !== undefined ? <pre className="diff-old">{e.before}</pre> : null}
                    {e.after !== undefined ? <pre className="diff-new">{e.after}</pre> : null}
                  </div>
                ))}
              </div>
            )
          ) : null}
        </Panel>
      ) : null}
      <p className="meta"><Link href={`${base}&tab=preview`}>Open the live preview</Link></p>
    </div>
  );
}

function Approval({ ws, here, candidate, canSign, signedByMe, actor }: { ws: WS; here: string; candidate?: Version; canSign: boolean; signedByMe: boolean; actor: Actor }) {
  const config = ws.config.approval;
  const forVersion = (id: string) => ws.signatures.filter((s) => s.versionId === id);
  const shown = ws.versions.filter((v) => v.kind === "candidate");
  return (
    <div className="page-stack">
      <Panel title="Approval workflow" description={`Each approval version needs ${config.clientSigners} client and ${config.companySigners} Elec Novatech signature${config.clientSigners + config.companySigners === 1 ? "" : "s"}.`}>
        <p className="help">Signatures are recorded electronically and bound to a fingerprint (SHA-256) of the exact version signed, with the signer&apos;s account, role, time, IP address and browser. This is an audited electronic approval record; it is not a qualified or certificate-based digital signature.</p>
        {!candidate ? <p className="meta">{ws.doc.status === "approved" ? "The current version is approved." : "No version is out for approval. Move the SRS to Approval pending when the completeness check is clear."}</p> : null}
      </Panel>
      {candidate && canSign ? (
        <Panel title={`Sign version ${candidate.label}`} description={`Fingerprint ${candidate.hash.slice(0, 16)}`}>
          <form action={srsAction} className="form">
            <Hidden values={{ intent: "sign", doc: ws.doc.id, back: here, versionId: candidate.id }} />
            <blockquote className="statement">{config.statement} Document {ws.doc.code}, version {candidate.label}, fingerprint {candidate.hash.slice(0, 16)}.</blockquote>
            <p className="meta"><a href={`/api/srs/${ws.doc.id}/download?ref=${candidate.id}&format=pdf`}>Read the exact version you are signing (PDF)</a></p>
            <label>Decision<select name="decision"><option value="approved">Approve this version</option><option value="rejected">Request changes</option></select></label>
            <label>Type your full name<input name="typedName" required autoComplete="name" placeholder={actor.name} /></label>
            <SignaturePad />
            <label>Comment<textarea name="comment" rows={2} placeholder="Required when requesting changes" /></label>
            <label className="check"><input type="checkbox" name="accept" required /> I have read the statement above and I am authorised to make this decision.</label>
            <div className="form-actions"><button className="btn btn-primary" type="submit">Record my decision</button></div>
          </form>
        </Panel>
      ) : candidate && signedByMe ? <p className="alert good">You have recorded your decision on version {candidate.label}.</p> : null}
      {shown.map((v) => (
        <Panel key={v.id} title={`Version ${v.label}`} description={`${v.status === "in_approval" ? "Awaiting signatures" : v.status.replaceAll("_", " ")} · fingerprint ${v.hash.slice(0, 16)}`} flush>
          {forVersion(v.id).length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No signatures yet.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Side</th><th>Signer</th><th>Role</th><th>Decision</th><th>Method</th><th>When</th><th>Record</th></tr></thead>
                <tbody>
                  {forVersion(v.id).map((s) => (
                    <tr key={s.id}>
                      <td>{s.side === "client" ? "Client" : "Elec Novatech"}</td>
                      <td><strong>{s.signerName}</strong></td>
                      <td className="meta">{s.signerRole}</td>
                      <td><Badge value={s.decision} />{s.comment ? <div className="meta">{s.comment}</div> : null}</td>
                      <td className="meta">{s.method}</td>
                      <td className="meta nowrap">{when(s.createdAt)}</td>
                      <td className="mono meta">{s.signatureHash.slice(0, 12)}{"ipAddress" in s && s.ipAddress ? ` · ${s.ipAddress}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}

async function Preview({ docId, status, download, canDraft, customer }: { docId: string; status: string; download: (r: string, f: string) => string; canDraft: boolean; customer: boolean }) {
  if (customer) {
    const shared = await prisma.srsVersion.findFirst({ where: { documentId: docId, clientVisible: true }, orderBy: { seq: "desc" } });
    if (!shared) return <Empty title="No version shared yet" body="The document appears here once the team sends it to you for review." />;
    const model = JSON.parse(shared.snapshot) as DocModel;
    const mark = shared.status === "approved" ? undefined : shared.status === "superseded" ? "SUPERSEDED" : shared.status === "in_approval" ? "PENDING APPROVAL" : "REVIEW COPY";
    return (
      <div className="page-stack">
        <div className="row">
          <p className="meta grow">Version {shared.label}, shared {when(shared.publishedAt)}. Comments and questions go in Discussion.</p>
          <span className="btn-group"><a className="btn btn-secondary btn-sm" href={`${download(shared.id, "pdf")}&inline=1`} target="_blank" rel="noreferrer">Open PDF</a><a className="btn btn-secondary btn-sm" href={download(shared.id, "docx")}>DOCX</a></span>
        </div>
        <DocPreview model={model} watermark={mark} />
      </div>
    );
  }
  const model: DocModel = buildDocModel(await loadDocInputs(prisma, docId));
  return (
    <div className="page-stack">
      <div className="row">
        <p className="meta grow">The preview uses the same content, numbering and order as the PDF and Word exports. Internal notes are never included.</p>
        {canDraft ? <span className="btn-group"><a className="btn btn-secondary btn-sm" href={`${download("latest", "pdf")}&inline=1`} target="_blank" rel="noreferrer">Open PDF</a><a className="btn btn-secondary btn-sm" href={download("latest", "docx")}>DOCX</a></span> : null}
      </div>
      <DocPreview model={model} watermark={status === "approved" ? undefined : "DRAFT"} />
    </div>
  );
}

export { OriginTag };
