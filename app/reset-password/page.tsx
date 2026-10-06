"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { resetAction } from "@/app/actions";
import { AuthShell } from "@/components/auth-shell";
import { FormError, PendingButton } from "@/components/form";

function Form() {
  const params = useSearchParams();
  const [state, action] = useActionState(resetAction, null);
  return (
    <form className="auth-card card" action={action}>
      <div>
        <p className="kicker">Account</p>
        <h1>Choose a new password</h1>
      </div>
      <FormError state={state} />
      <input type="hidden" name="token" value={params.get("token") ?? ""} />
      <label>New password<input name="password" type="password" autoComplete="new-password" required minLength={10} /></label>
      <p className="help">At least 10 characters, with a letter, a number, and a symbol.</p>
      <PendingButton label="Update password" />
    </form>
  );
}

export default function ResetPage() {
  return <AuthShell><Suspense fallback={<p>Loading…</p>}><Form /></Suspense></AuthShell>;
}
