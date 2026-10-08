import { actorFromToken } from "@/lib/domain/auth";
import { downloadSrs } from "@/lib/domain/srs/artifacts";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { readCookie, SESSION_COOKIE } from "@/lib/cookies";

export const runtime = "nodejs";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(req.url);
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  const actor = await actorFromToken(token);
  if (!actor) return Response.json({ error: { message: "Sign in to continue." } }, { status: 401 });
  try {
    const format = url.searchParams.get("format") ?? "pdf";
    const file = await downloadSrs(actor, id, { ref: url.searchParams.get("ref") ?? "approved", format });
    const inline = format === "pdf" && url.searchParams.get("inline") === "1";
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "content-type": file.mediaType,
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${file.fileName.replace(/[^\w.\-]/g, "_")}"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
        "referrer-policy": "no-referrer",
      },
    });
  } catch (error) {
    if (!(error instanceof AppError)) log("error", "srs.download_failed", { documentId: id, error: error instanceof Error ? error.message : String(error) });
    const status = error instanceof AppError ? error.status : 500;
    const message = error instanceof AppError ? error.message : "The document could not be generated. Please try again.";
    return Response.json({ error: { message } }, { status });
  }
}
