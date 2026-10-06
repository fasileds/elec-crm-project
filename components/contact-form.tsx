"use client";

import { useActionState } from "react";
import { contactAction } from "@/app/actions";
import { FormError, Idempotency, PendingButton } from "@/components/form";

export function ContactForm({ customerId }: { customerId: string }) {
  const [state, action] = useActionState(contactAction, null);
  return (
    <form action={action} className="form">
      <FormError state={state} />
      <Idempotency />
      <input type="hidden" name="customerId" value={customerId} />
      <label>Contact name<input name="name" required /></label>
      <div className="form-row">
        <label>Email<input name="email" type="email" /></label>
        <label>Title<input name="title" placeholder="e.g. CTO" /></label>
      </div>
      <label className="check"><input name="isPrimary" type="checkbox" /> Primary contact</label>
      <div className="form-actions"><PendingButton label="Add contact" /></div>
    </form>
  );
}
