"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { inviteAction } from "@/app/actions";
import { AuthShell } from "@/components/auth-shell";
import { FormError, PendingButton } from "@/components/form";

function Form() {
  const params = useSearchParams();
  const [state, action] = useActionState(inviteAction, null);
  return (
    <form className="auth-card card" action={action}>
      <div>
        <p className="kicker">Invitation</p>
        <h1>Accept invitation</h1>
      </div>
      <FormError state={state} />
      <input type="hidden" name="token" value={params.get("token") ?? ""} />
      <label>Password<input name="password" type="password" autoComplete="new-password" required minLength={10} /></label>
      <p className="help">At least 10 characters, with a letter, a number, and a symbol.</p>
      <PendingButton label="Create account" />
    </form>
  );
}

export default function InvitePage() {
  return <AuthShell><Suspense fallback={<p>Loading…</p>}><Form /></Suspense></AuthShell>;
}
