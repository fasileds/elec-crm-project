import { prisma } from "@/lib/db";
import { verifyResendSignature } from "@/lib/email/webhook";
import { log } from "@/lib/log";

export const runtime = "nodejs";

const STATUS: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.failed": "failed",
  "email.delivery_delayed": "failed",
};

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: { message: "Webhook secret is not configured." } }, { status: 401 });
  const body = await req.text();
  const id = req.headers.get("svix-id") ?? "";
  const timestamp = req.headers.get("svix-timestamp") ?? "";
  const signature = req.headers.get("svix-signature") ?? "";
  const valid = verifyResendSignature({ secret, id, timestamp, signature, body });
  if (!valid) {
    log("warn", "webhook.rejected", { provider: "resend" });
    return Response.json({ error: { message: "Invalid webhook signature." } }, { status: 401 });
  }
  const event = JSON.parse(body) as { type?: string; data?: { email_id?: string } };
  const eventId = id || `${event.type}:${event.data?.email_id ?? "unknown"}`;
  const existing = await prisma.webhookEvent.findUnique({ where: { provider_eventId: { provider: "resend", eventId } } });
  if (existing) return Response.json({ data: { duplicate: true } });
  await prisma.webhookEvent.create({ data: { provider: "resend", eventId, type: event.type ?? "unknown", status: "processed" } });
  const next = STATUS[event.type ?? ""];
  if (next && event.data?.email_id) {
    await prisma.emailMessage.updateMany({ where: { providerId: event.data.email_id }, data: { status: next } });
  }
  log("info", "webhook.processed", { provider: "resend", type: event.type });
  return Response.json({ data: { ok: true } });
}
