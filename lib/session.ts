import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { actorFromToken } from "@/lib/domain/auth";
import type { Actor } from "@/lib/actor";
import { SESSION_COOKIE } from "@/lib/cookies";

export { SESSION_COOKIE };

export async function currentActor(): Promise<Actor | null> {
  const jar = await cookies();
  return actorFromToken(jar.get(SESSION_COOKIE)?.value);
}

export async function requireUser() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  return actor;
}

export async function requireEmployee() {
  const actor = await requireUser();
  if (actor.kind !== "employee") redirect("/portal");
  return actor;
}

export async function requireCustomer() {
  const actor = await requireUser();
  if (actor.kind !== "customer") redirect("/dashboard");
  return actor;
}
