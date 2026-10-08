import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { forbidden, notFound } from "@/lib/errors";

const LOCAL_ROOT = path.resolve(process.cwd(), "storage");
const KEY = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

type Supabase = { url: string; key: string; bucket: string };

function supabase(): Supabase | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key, bucket: process.env.SUPABASE_STORAGE_BUCKET || "elec-files" };
}

export function storageBackend() {
  return supabase() ? "supabase" : "local";
}

function checkKey(key: string) {
  if (!KEY.test(key)) throw forbidden("Invalid storage path.");
}

function headers(config: Supabase, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${config.key}`, apikey: config.key, ...extra };
}

function objectUrl(config: Supabase, key: string) {
  return `${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}/${key}`;
}

/** Creates the private bucket if it does not exist. Safe to call repeatedly. */
export async function ensureBucket() {
  const config = supabase();
  if (!config) return false;
  const existing = await fetch(`${config.url}/storage/v1/bucket/${encodeURIComponent(config.bucket)}`, { headers: headers(config), cache: "no-store" });
  if (existing.ok) return true;
  const created = await fetch(`${config.url}/storage/v1/bucket`, {
    method: "POST",
    headers: headers(config, { "Content-Type": "application/json" }),
    body: JSON.stringify({ id: config.bucket, name: config.bucket, public: false }),
  });
  if (!created.ok && created.status !== 409) throw new Error(`Could not create storage bucket (${created.status}).`);
  return true;
}

/** Stores new bytes under a server-generated key. Never overwrites an existing object. */
export async function putObject(key: string, bytes: Uint8Array, contentType: string) {
  checkKey(key);
  const config = supabase();
  if (!config) {
    const absolute = path.join(LOCAL_ROOT, ...key.split("/"));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes, { flag: "wx" });
    return;
  }
  const upload = () =>
    fetch(objectUrl(config, key), {
      method: "POST",
      headers: headers(config, { "Content-Type": contentType || "application/octet-stream", "x-upsert": "false" }),
      body: Buffer.from(bytes),
    });
  let response = await upload();
  if (response.status === 404 || response.status === 400) {
    const body = await response.text();
    if (!/bucket not found/i.test(body)) throw new Error(`Storage upload failed (${response.status}).`);
    await ensureBucket();
    response = await upload();
  }
  if (!response.ok) throw new Error(`Storage upload failed (${response.status}).`);
}

export async function getObject(key: string): Promise<Buffer> {
  checkKey(key);
  const config = supabase();
  if (!config) {
    try {
      return await readFile(path.join(LOCAL_ROOT, ...key.split("/")));
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") throw notFound("File not found.");
      throw error;
    }
  }
  const response = await fetch(objectUrl(config, key), { headers: headers(config), cache: "no-store" });
  if (response.status === 404 || response.status === 400) throw notFound("File not found.");
  if (!response.ok) throw new Error(`Storage download failed (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}
