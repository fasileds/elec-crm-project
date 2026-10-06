import { readDocument } from "@/lib/domain/documents";
import { actorFromToken } from "@/lib/domain/auth";
import { AppError } from "@/lib/errors";
import { SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const raw = req.headers.get("cookie") ?? "";
  const found = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  const token = found ? decodeURIComponent(found.slice(SESSION_COOKIE.length + 1)) : undefined;
  const actor = await actorFromToken(token);
  if (!actor) return Response.json({ error: { message: "Sign in to continue." } }, { status: 401 });
  try {
    const file = await readDocument(actor, id);
    return new Response(Buffer.from(file.bytes), {
      headers: {
        "content-type": file.mediaType,
        "content-disposition": `attachment; filename="${file.fileName.replaceAll('"', "")}"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    const message = error instanceof AppError ? error.message : "The file could not be downloaded.";
    return Response.json({ error: { message } }, { status });
  }
}
