"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions";
import { FormError, PendingButton } from "@/components/form";

export function ImportForm({ action }: { action: (state: ActionState, formData: FormData) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form className="form" action={formAction}>
      <p className="help">Paste CSV with a header row. Required column: <strong>name</strong>. Optional: email, company, phone, source. Rows with an email already in the CRM are skipped, invalid rows are reported, and at most 500 rows are accepted.</p>
      <FormError state={state} />
      <label>CSV data<textarea name="csv" required rows={8} style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }} placeholder={"name,email,company,phone,source\nAda Example,ada@example.com,Example Co,+15551212,website"} /></label>
      <div className="form-actions"><PendingButton label="Import leads" /></div>
    </form>
  );
}
