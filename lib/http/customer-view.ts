const HIDDEN = new Set([
  "notes",
  "searchText",
  "customFields",
  "storageKey",
  "checksum",
  "password",
  "passwordHash",
  "token",
  "secret",
  "apiKey",
  "authorization",
  "cookie",
]);

/**
 * Customer API responses stay on the records the portal already shares.
 * Internal notes, unpublished files, and secrets are removed before the JSON is sent.
 * The website still reads the domain functions directly, so its pages are unchanged.
 */
export function stripForCustomer(value: unknown): unknown {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripForCustomer(item)).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (isHiddenFile(record)) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (HIDDEN.has(key)) continue;
    const next = stripForCustomer(entry);
    if (next !== undefined) output[key] = next;
  }
  return output;
}

function isHiddenFile(record: Record<string, unknown>) {
  if (record.visibility === "internal") return true;
  const looksLikeFile = typeof record.fileName === "string" || typeof record.storageKey === "string";
  return looksLikeFile && typeof record.visibility === "string" && record.visibility !== "customer";
}
