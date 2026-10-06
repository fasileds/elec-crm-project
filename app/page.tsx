import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session";

export default async function Home() {
  const actor = await currentActor();
  redirect(actor?.kind === "customer" ? "/portal" : actor ? "/dashboard" : "/login");
}
