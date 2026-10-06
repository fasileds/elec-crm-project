import { createHmac } from "node:crypto";

function decodeSecret(secret: string) {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  return Buffer.from(raw, "base64");
}

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index]! ^ right[index]!;
  return mismatch === 0;
}

export function verifyResendSignature(input: {
  secret: string;
  id: string;
  timestamp: string;
  signature: string;
  body: string;
  now?: number;
  toleranceSeconds?: number;
}) {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const timestamp = Number(input.timestamp);
  const tolerance = input.toleranceSeconds ?? 300;
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > tolerance) return false;
  const signed = `${input.id}.${input.timestamp}.${input.body}`;
  const digest = createHmac("sha256", decodeSecret(input.secret)).update(signed).digest("base64");
  return input.signature.split(" ").some((part) => {
    const [, value] = part.split(",");
    return Boolean(value) && timingSafeEqual(value, digest);
  });
}
