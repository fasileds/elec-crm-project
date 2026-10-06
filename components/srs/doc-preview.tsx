import { ORIGIN_LABELS, PRIORITY_LABELS, QA_LABELS, type Origin } from "@/lib/domain/srs/catalog";
import type { DocBlock, DocItem, DocModel } from "@/lib/domain/srs/model";

function Paras({ text }: { text: string }) {
  return <>{text.split(/\n{2,}/).map((p, i) => <p key={i} style={{ whiteSpace: "pre-wrap" }}>{p}</p>)}</>;
}

function Item({ item }: { item: DocItem }) {
  return (
    <div className={`doc-item origin-${item.origin}`} id={`item-${item.key}`}>
      <div className="doc-item-head"><strong>{item.key}</strong><strong>{item.title}</strong></div>
      <div className="doc-item-meta">
        <span>{PRIORITY_LABELS[item.priority] ?? item.priority}</span>
        <span>{item.status.replaceAll("_", " ")}</span>
        <span className={`origin-tag ${item.origin}`}>{ORIGIN_LABELS[item.origin as Origin] ?? item.origin}</span>
      </div>
      {item.description ? <Paras text={item.description} /> : null}
      {item.fields.length ? (
        <dl className="doc-fields">{item.fields.map(([k, v]) => <div key={k}><dt>{k}</dt><dd style={{ whiteSpace: "pre-wrap" }}>{v}</dd></div>)}</dl>
      ) : null}
      {item.steps?.length ? (
        <ol className="doc-flow">
          {item.steps.map((step) => (
            <li key={step.id} className={step.type}>
              <strong>{step.id}. {step.type === "decision" ? "Decision: " : ""}{step.action}</strong>
              <span>{[step.actor && `Actor: ${step.actor}`, step.input && `Input: ${step.input}`, step.output && `Output: ${step.output}`, step.yes && `Yes → ${step.yes}`, step.no && `No → ${step.no}`].filter(Boolean).join(" · ")}</span>
              {step.exception ? <em>Exception: {step.exception}</em> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {item.criteria.map((c, i) => (
        <div key={i} className="doc-ac"><b>AC{i + 1}</b> <b>Given</b> {c.given} <b>When</b> {c.when} <b>Then</b> {c.then} <span className="meta">QA: {QA_LABELS[c.qa] ?? c.qa}</span></div>
      ))}
    </div>
  );
}

function Block({ block }: { block: DocBlock }) {
  if (block.type === "text") return <div>{block.caption ? <div className="doc-caption">{block.caption}</div> : null}<Paras text={block.text} /></div>;
  if (block.type === "notice") return <p className="doc-notice">{block.text}</p>;
  if (block.type === "table")
    return (
      <div>
        {block.caption ? <div className="doc-caption">{block.caption}</div> : null}
        <table className="doc-table"><thead><tr>{block.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{block.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
      </div>
    );
  return <div>{block.items.map((item) => <Item key={item.key} item={item} />)}</div>;
}

export function DocPreview({ model, watermark }: { model: DocModel; watermark?: string }) {
  const accent = model.meta.accent;
  return (
    <article className="srs-doc" style={{ ["--doc-accent" as string]: accent }}>
      {watermark ? <div className="doc-watermark" aria-hidden="true">{watermark}</div> : null}
      <section className="doc-page doc-cover">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo.jpg" alt="Elec Novatech PLC" width={140} height={140} className="doc-logo" />
        <p className="doc-kicker">Software Requirements Specification</p>
        <h1>{model.meta.projectName}</h1>
        <p className="doc-sub">{model.meta.projectType}</p>
        <table className="doc-table">
          <tbody>
            {[["Document ID", model.meta.code], ["Version", model.meta.version], ["Status", model.meta.statusLabel], ["Prepared by", model.meta.preparedBy], ["Prepared for", model.meta.preparedFor], ["Created", model.meta.createdOn], ["Template", model.meta.template], ["Classification", model.meta.confidentiality]].map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
          </tbody>
        </table>
      </section>
      <section className="doc-page">
        <h2>Document control</h2>
        <div className="doc-caption">Revision history</div>
        <table className="doc-table"><thead><tr><th>Version</th><th>Date</th><th>Author</th><th>Status</th><th>Notes</th></tr></thead><tbody>{model.revisions.length ? model.revisions.map((r, i) => <tr key={i}><td>{r.version}</td><td>{r.date}</td><td>{r.author}</td><td>{r.status}</td><td>{r.note}</td></tr>) : <tr><td>{model.meta.version}</td><td>{model.meta.updatedOn}</td><td>—</td><td>{model.meta.statusLabel}</td><td>Working draft</td></tr>}</tbody></table>
        <div className="doc-caption">Approvals</div>
        <table className="doc-table"><thead><tr><th>Side</th><th>Name</th><th>Role</th><th>Decision</th><th>Date</th><th>Fingerprint</th></tr></thead><tbody>{model.approval.signatures.length ? model.approval.signatures.map((s, i) => <tr key={i}><td>{s.side === "client" ? "Client" : "Elec Novatech"}</td><td>{s.name}</td><td>{s.role}</td><td>{s.decision}</td><td>{s.date}</td><td className="mono">{s.hash}</td></tr>) : <tr><td colSpan={6}>Requires {model.approval.clientSigners} client and {model.approval.companySigners} Elec Novatech approval(s).</td></tr>}</tbody></table>
        <h2>Contents</h2>
        <ol className="doc-toc">
          {model.groups.map((g) => (
            <li key={g.number}>
              <a href={`#sec-${g.number}`}><span>{g.number}</span>{g.title}</a>
              <ol>{g.sections.map((s) => <li key={s.number}><a href={`#sec-${s.number}`}><span>{s.number}</span>{s.title}</a></li>)}</ol>
            </li>
          ))}
        </ol>
      </section>
      <section className="doc-page">
        {model.groups.map((group) => (
          <div key={group.number}>
            <h2 id={`sec-${group.number}`} className="doc-group">{group.number}&nbsp;&nbsp;{group.title}</h2>
            {group.sections.map((section) => (
              <section key={section.number} className="doc-section">
                <h3 id={`sec-${section.number}`}>{section.number}&nbsp;&nbsp;{section.title}</h3>
                {section.notApplicable ? <p className="doc-notice">Not applicable: {section.notApplicable}</p> : section.blocks.map((b, i) => <Block key={i} block={b} />)}
              </section>
            ))}
          </div>
        ))}
      </section>
    </article>
  );
}
