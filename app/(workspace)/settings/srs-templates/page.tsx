import Link from "next/link";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { listTemplates } from "@/lib/domain/srs/templates";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "SRS templates" };

export default async function SrsTemplatesPage() {
  const actor = await requireEmployee();
  const templates = await listTemplates(actor);
  return (
    <main>
      <PageHeader
        crumbs={[{ href: "/settings", label: "Settings" }, { label: "SRS templates" }]}
        title="SRS templates"
        lede="Templates define the sections, wizard questions, required requirement types, approval signers and styling of each SRS. Saving creates a new version; documents keep the version they were created from."
      />
      <Panel flush>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Template</th><th>Project type</th><th className="right">Version</th><th className="right">Documents</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id}>
                  <td><Link href={`/settings/srs-templates/${template.id}`}><strong>{template.name}</strong></Link><div className="meta">{template.description}</div></td>
                  <td>{template.isMaster ? <span className="badge info">master</span> : template.projectType}</td>
                  <td className="right num">v{template.currentVersion}</td>
                  <td className="right num">{template.documents}</td>
                  <td><Badge value={template.active ? "active" : "inactive"} /></td>
                  <td className="meta nowrap">{formatDateTime(template.updatedAt, actor.timezone, actor.locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </main>
  );
}
