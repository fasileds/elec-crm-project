/** Browser origins that may call /api/v1. Native apps send no Origin header. */

export function browserOriginAllowed(origin: string) {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    if (isExpoDevHost(host)) return true;
    return isPrivateIpv4(host);
  } catch {
    return false;
  }
}

function isExpoDevHost(host: string) {
  return (
    host.endsWith(".expo.dev") ||
    host.endsWith(".exp.direct") ||
    host.endsWith(".exp.host") ||
    host.endsWith(".ngrok-free.app") ||
    host.endsWith(".ngrok.io")
  );
}

function isPrivateIpv4(host: string) {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = numbers;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  return a === 172 && b >= 16 && b <= 31;
}

export function corsHeaders(req: { headers: { get(name: string): string | null } }) {
  const headers = new Headers();
  const origin = req.headers.get("origin");
  if (!origin || !browserOriginAllowed(origin)) return headers;
  headers.set("access-control-allow-origin", origin);
  headers.set("vary", "origin");
  headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("access-control-allow-headers", "Authorization, Content-Type, Accept, Idempotency-Key");
  headers.set("access-control-max-age", "86400");
  return headers;
}

export function applyCors(req: Request, response: Response) {
  corsHeaders(req).forEach((value, key) => response.headers.set(key, value));
  return response;
}
