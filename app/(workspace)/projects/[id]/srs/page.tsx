import { SrsWorkspace } from "@/components/srs/workspace";
import { requireEmployee } from "@/lib/session";

type Query = Record<string, string | undefined>;

export default async function ProjectSrsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const actor = await requireEmployee();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <SrsWorkspace actor={actor} projectId={id} query={query} />;
}
