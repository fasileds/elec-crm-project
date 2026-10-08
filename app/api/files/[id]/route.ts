import { readDocument } from "@/lib/domain/documents";
import { actorFromToken } from "@/lib/domain/auth";
import { AppError } from "@/lib/errors";
import { readCookie, SESSION_COOKIE } from "@/lib/cookies";

export const runtime = "nodejs";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
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
