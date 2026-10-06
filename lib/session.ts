import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { actorFromToken } from "@/lib/domain/auth";
import type { Actor } from "@/lib/actor";

export const SESSION_COOKIE = "elec_session";

export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
    },
  };
}

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
