/**
 * The browser keeps the cookie for the absolute session cap. The server still ends the session
 * after 12 hours without use, and never later than 7 days after sign-in. Rewriting the cookie
 * on every page is unnecessary, and a server component is not allowed to set cookies.
 *
 * Production uses the __Host- prefix: the cookie must be Secure, Path=/, and must not set a
 * Domain, so a subdomain cannot plant a session cookie. Local http cannot set Secure.
 */
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;

const SECURE = process.env.NODE_ENV === "production";

export const SESSION_COOKIE = SECURE ? "__Host-elec_session" : "elec_session";

export function sessionCookieOptions(maxAge = SESSION_ABSOLUTE_MS / 1000) {
  return {
    httpOnly: true as const,
    secure: SECURE,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

function attributes(maxAge: number) {
  return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${SECURE ? "; Secure" : ""}`;
}

export function sessionSetCookie(token: string) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${attributes(SESSION_ABSOLUTE_MS / 1000)}`;
}

export function sessionClearCookie() {
  return `${SESSION_COOKIE}=; ${attributes(0)}`;
}

/** Reads one cookie. Names must match exactly, and a bad encoding is treated as absent. */
export function readCookie(header: string | null, name: string) {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1 || trimmed.slice(0, eq) !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}
