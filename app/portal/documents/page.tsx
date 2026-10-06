import { PageHeader } from "@/components/ui";
import { listDocuments } from "@/lib/domain/documents";
import { requireCustomer } from "@/lib/session";

export const metadata = { title: "Shared documents" };

export default async function PortalDocuments() {
  const actor = await requireCustomer();
  const documents = await listDocuments(actor, {});
  return (
    <main>
      <PageHeader kicker="Files" title="Shared with you" lede="Only documents your team marked as customer-visible are listed." />
      <div className="card">
        {documents.length === 0 ? <p>Nothing has been shared yet.</p> : documents.map((document) => <div className="item" key={document.id}><a href={`/api/files/${document.id}`}><strong>{document.fileName}</strong></a><div className="meta">{document.category} · {document.uploaderName}</div></div>)}
      </div>
    </main>
  );
}
