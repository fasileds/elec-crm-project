import { dispatch, loginCookieHeader } from "@/lib/http/dispatch";

export const runtime = "nodejs";

async function handle(req: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const response = await dispatch(req, path);
  if (path.join("/") === "auth/login" && response.ok) {
    const payload = (await response.json()) as { data?: { token?: string; user?: unknown } };
    const headers = new Headers(response.headers);
    if (payload.data?.token) headers.append("set-cookie", loginCookieHeader(payload.data.token));
    return Response.json({ data: { user: payload.data?.user } }, { status: 200, headers });
  }
  if (path.join("/") === "auth/logout") {
    response.headers.append("set-cookie", "elec_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  }
  return response;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
