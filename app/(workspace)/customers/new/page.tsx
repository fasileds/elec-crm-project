"use client";

import { useActionState } from "react";
import { customerAction } from "@/app/actions";
import { FormError, Idempotency, PendingButton } from "@/components/form";
import { PageHeader } from "@/components/ui";

export default function NewCustomerPage() {
  const [state, action] = useActionState(customerAction, null);
  return (
    <main>
      <PageHeader kicker="CRM" title="New customer" lede="Exact email matches are blocked so you do not create a second record for someone you already know." />
      <form className="card grid" action={action} style={{ maxWidth: 720 }}>
        <FormError state={state} />
        <Idempotency />
        <label>Name<input name="name" required minLength={2} /></label>
        <label>Kind<select name="kind" defaultValue="company"><option value="company">Company</option><option value="individual">Individual</option></select></label>
        <label>Status<select name="status" defaultValue="active">{["lead", "qualified", "opportunity", "proposal", "negotiation", "onboarding", "active"].map((status) => <option key={status}>{status}</option>)}</select></label>
        <label>Industry<select name="industry" defaultValue=""><option value="">Choose</option>{["software", "healthcare", "finance", "retail", "education", "manufacturing", "professional_services", "other"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Source<select name="source" defaultValue=""><option value="">Choose</option>{["website", "referral", "outbound", "event", "partner", "other"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Notes<textarea name="notes" /></label>
        <PendingButton label="Create customer" />
      </form>
    </main>
  );
}
