import { actorFromToken } from "@/lib/domain/auth";
import { exportRows } from "@/lib/domain/insights";
import { AppError } from "@/lib/errors";
import { readCookie, SESSION_COOKIE } from "@/lib/cookies";

export const runtime = "nodejs";

export async function GET(req: Request, context: { params: Promise<{ type: string }> }) {
  const { type } = await context.params;
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  const actor = await actorFromToken(token);
  if (!actor) return Response.json({ error: { message: "Sign in to continue." } }, { status: 401 });
  if (type !== "customers" && type !== "projects" && type !== "tasks" && type !== "time") {
    return Response.json({ error: { message: "Unknown export." } }, { status: 422 });
  }
  try {
    const csv = await exportRows(actor, type);
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${type}.csv"`, "cache-control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    const message = error instanceof AppError ? error.message : "Export failed.";
    return Response.json({ error: { message } }, { status });
  }
}
