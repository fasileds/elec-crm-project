export function normalizeSearch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function cleanText(value: string, max = 8000) {
  return value.replace(/\u0000/g, "").trim().slice(0, max);
}

export function safeFileName(name: string) {
  const base = name.split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[^\w.\- ()]+/g, "_").replace(/^\.+/, "").slice(0, 120);
  return cleaned || "file";
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export function searchBlob(parts: Array<string | null | undefined>) {
  return normalizeSearch(parts.filter(Boolean).join(" "));
}

const SENSITIVE = /password|token|secret|api[_-]?key|authorization|cookie|hash/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE.test(key) ? "[redacted]" : redact(entry);
  }
  return output;
}
