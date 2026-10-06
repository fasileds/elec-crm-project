"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/app/actions";
import { AuthShell } from "@/components/auth-shell";
import { FormError, PendingButton } from "@/components/form";

export default function LoginPage() {
  const [state, action] = useActionState(loginAction, null);
  return (
    <AuthShell>
      <form className="auth-card card" action={action}>
        <div>
          <p className="kicker">Sign in</p>
          <h2>Welcome back</h2>
          <p className="lede">Use the email address for your Elec Novatech workspace.</p>
        </div>
        <FormError state={state} />
        <label>Email<input name="email" type="email" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        <PendingButton label="Sign in" />
        <Link href="/forgot-password">Forgot password</Link>
      </form>
    </AuthShell>
  );
}
