"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgotAction } from "@/app/actions";
import { AuthShell } from "@/components/auth-shell";
import { FormError, PendingButton } from "@/components/form";

export default function ForgotPage() {
  const [state, action] = useActionState(forgotAction, null);
  return (
    <AuthShell>
      <form className="auth-card card" action={action}>
        <div>
          <p className="kicker">Account</p>
          <h1>Reset password</h1>
          <p className="help">We will send a link if the account exists. The response is the same either way.</p>
        </div>
        <FormError state={state} />
        <label>Email<input name="email" type="email" autoComplete="username" required /></label>
        <PendingButton label="Send reset link" />
        <Link href="/login">Back to sign in</Link>
      </form>
    </AuthShell>
  );
}
