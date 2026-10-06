import { Upload } from "lucide-react";
import { UploadForm } from "@/components/upload-form";
import { Badge, Drawer, Empty, PageHeader, Panel } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { listDocuments } from "@/lib/domain/documents";
import { listProjects } from "@/lib/domain/projects";
import { requireEmployee } from "@/lib/session";

export const metadata = { title: "Documents" };

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function DocumentsPage() {
  const actor = await requireEmployee();
  const [documents, projects] = await Promise.all([listDocuments(actor, {}), listProjects(actor, {})]);
  const names = new Map(projects.items.map((project) => [project.id, project.name]));
  return (
    <main>
      <PageHeader
        title="Documents"
        lede="Downloads require a signed-in session. The file type is checked from its contents, not the browser label."
        action={<Drawer label="Upload" title="Upload a document" primary icon={<Upload size={15} aria-hidden="true" />}><UploadForm projects={projects.items.map((project) => ({ id: project.id, name: project.name }))} /></Drawer>}
      />
      <Panel flush>
        {documents.length === 0 ? <Empty title="No documents yet" body="Upload proposals, specifications, contracts and deliverables against a project." /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>File</th><th>Project</th><th>Category</th><th>Visibility</th><th className="right">Size</th><th>Version</th><th>Uploaded</th></tr></thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.id}>
                    <td><a href={`/api/files/${document.id}`}><strong>{document.fileName}</strong></a></td>
                    <td>{document.projectId ? names.get(document.projectId) ?? "—" : "—"}</td>
                    <td style={{ textTransform: "capitalize" }}>{document.category}</td>
                    <td><Badge value={document.visibility} /></td>
                    <td className="right num meta">{size(document.byteSize)}</td>
                    <td className="num">v{document.version}</td>
                    <td className="nowrap"><span>{document.uploaderName}</span><div className="meta">{formatDateTime(document.createdAt, actor.timezone, actor.locale)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </main>
  );
}
