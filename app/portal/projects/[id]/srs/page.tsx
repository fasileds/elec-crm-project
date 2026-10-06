import { SrsWorkspace } from "@/components/srs/workspace";
import { requireCustomer } from "@/lib/session";

type Query = Record<string, string | undefined>;

export default async function PortalSrsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const actor = await requireCustomer();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <SrsWorkspace actor={actor} projectId={id} query={query} />;
}
