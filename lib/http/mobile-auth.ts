/** Bearer parsing and the split between the website cookie and the mobile token. */

export function readBearer(header: string | null) {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

export function hasBearer(header: string | null) {
  return Boolean(readBearer(header));
}

const PUBLIC_AUTH = /^\/api\/v1\/auth\/(login|mobile-login|forgot-password|reset-password|verify-email|accept-invite)$/;

export function isPublicAuthPath(pathname: string) {
  return PUBLIC_AUTH.test(pathname);
}

/** Page routes stay on the cookie. API calls may present the mobile bearer instead. */
export function hasApiBearer(pathname: string, authorization: string | null) {
  return pathname.startsWith("/api/") && hasBearer(authorization);
}

type LoginPayload = { data?: { token?: string; user?: unknown } };

/**
 * Website login keeps the opaque session in an HttpOnly cookie and does not return it.
 * Mobile login returns that same token once and does not set the cookie.
 */
export function finishLogin(path: string[]) {
  const joined = path.join("/");
  if (joined !== "auth/login" && joined !== "auth/mobile-login") return null;
  const mobile = joined === "auth/mobile-login";
  return {
    present(payload: LoginPayload) {
      const user = payload.data?.user ?? null;
      if (mobile) return { body: { data: { token: payload.data?.token, user } }, cookie: null as string | null };
      return { body: { data: { user } }, cookie: payload.data?.token ?? null };
    },
  };
}
