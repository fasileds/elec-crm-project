"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";

export function PendingButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button className="btn btn-primary" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Working…" : label}</button>;
}

export function FormError({ state }: { state: ActionState }) {
  if (!state?.error && !state?.ok) return null;
  return <div className={state.error ? "alert" : "alert ok"} role="status">{state.error ?? state.ok}</div>;
}

export function Idempotency() {
  const [key] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="idempotencyKey" value={key} />;
}
