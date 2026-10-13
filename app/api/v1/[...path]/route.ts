import { sessionClearCookie, sessionSetCookie } from "@/lib/cookies";
import { dispatch } from "@/lib/http/dispatch";
import { finishLogin } from "@/lib/http/mobile-auth";

export const runtime = "nodejs";

async function handle(req: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const response = await dispatch(req, path);
  const login = finishLogin(path);
  if (login && response.ok) {
    const payload = (await response.json()) as { data?: { token?: string; user?: unknown } };
    const headers = new Headers(response.headers);
    const finished = login.present(payload);
    if (finished.cookie) headers.append("set-cookie", sessionSetCookie(finished.cookie));
    return Response.json(finished.body, { status: 200, headers });
  }
  if (path.join("/") === "auth/logout") {
    response.headers.append("set-cookie", sessionClearCookie());
  }
  return response;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
