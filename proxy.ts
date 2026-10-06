import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = [/^\/login$/, /^\/forgot-password$/, /^\/reset-password$/, /^\/invite$/, /^\/verify-email$/, /^\/api\/webhooks\//, /^\/api\/v1\/auth\/(login|forgot-password|reset-password|verify-email|accept-invite)$/];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.includes(".")) return NextResponse.next();
  const session = request.cookies.get("elec_session")?.value;
  const isPublic = PUBLIC.some((pattern) => pattern.test(pathname)) || pathname === "/";
  if (!session && !isPublic && (pathname.startsWith("/api") || pathname.startsWith("/portal") || isApp(pathname))) {
    if (pathname.startsWith("/api")) return NextResponse.json({ error: { message: "Sign in to continue." } }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestHeaders.get("x-request-id") ?? crypto.randomUUID());
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

function isApp(pathname: string) {
  return ["/dashboard", "/customers", "/leads", "/projects", "/work", "/approvals", "/time", "/documents", "/reports", "/people", "/notifications", "/settings", "/search"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
