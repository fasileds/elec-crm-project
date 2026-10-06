import { templateAction } from "@/app/srs-actions";
import { TemplateEditor } from "@/components/srs/template-editor";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { KINDS } from "@/lib/domain/srs/catalog";
import { getTemplate } from "@/lib/domain/srs/templates";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "Edit SRS template" };

export default async function SrsTemplatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const actor = await requireEmployee();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { template, config } = await getTemplate(actor, id);
  const kinds = Object.entries(KINDS).map(([key, meta]) => [key, meta.plural] as [string, string]);
  return (
    <main>
      <PageHeader
        crumbs={[{ href: "/settings", label: "Settings" }, { href: "/settings/srs-templates", label: "SRS templates" }, { label: template.name }]}
        title={template.name}
        badges={<><Badge value={template.active ? "active" : "inactive"} />{template.isMaster ? <span className="badge info">master</span> : null}</>}
        facts={<><span>Current version <strong>v{template.currentVersion}</strong></span><span>{config.sections.length} sections · {config.steps.reduce((sum, step) => sum + step.questions.length, 0)} questions</span></>}
      />
      {query.error ? <p className="alert bad" role="alert">{query.error}</p> : null}
      {query.notice ? <p className="alert good" role="status">{query.notice}</p> : null}
      <div className="record">
        <div className="record-main">
          <form action={templateAction} className="form">
            <input type="hidden" name="id" value={template.id} />
            <input type="hidden" name="version" value={template.currentVersion} />
            <TemplateEditor initial={config} kinds={kinds} />
            <Panel title="Publish">
              <div className="form-grid">
                <label>What changed?<input name="note" required minLength={3} maxLength={300} placeholder="Added data retention question" /></label>
                {!template.isMaster ? <label>Used for new projects<select name="active" defaultValue={template.active ? "on" : "off"}><option value="on">Yes</option><option value="off">No — fall back to the master</option></select></label> : null}
              </div>
              <div className="form-actions"><button className="btn btn-primary" type="submit">Save new version</button></div>
            </Panel>
          </form>
        </div>
        <aside className="record-aside">
          <Panel title="Version history" flush>
            <ul className="rows">
              {template.versions.map((version) => (
                <li key={version.id}>
                  <div className="grow"><strong>v{version.version}</strong><span className="meta">{version.note || "—"}</span><span className="meta">{version.createdByName} · {formatDateTime(version.createdAt, actor.timezone, actor.locale)}</span></div>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </main>
  );
}
