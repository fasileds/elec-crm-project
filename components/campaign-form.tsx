"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions";
import { FormError, PendingButton } from "@/components/form";

export function CampaignForm({ action }: { action: (state: ActionState, formData: FormData) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form className="form" action={formAction}>
      <FormError state={state} />
      <label>Campaign name<input name="name" required /></label>
      <div className="form-row">
        <label>Channel<select name="channel" defaultValue="email">{["email", "event", "outbound", "partner", "website", "social", "other"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Lead source<select name="source" defaultValue=""><option value="">None</option>{["website", "referral", "outbound", "event", "partner", "other"].map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      <div className="form-row">
        <label>Starts<input name="startsOn" type="date" /></label>
        <label>Ends<input name="endsOn" type="date" /></label>
      </div>
      <div className="form-row">
        <label>Budget<input name="budget" inputMode="decimal" placeholder="0.00" /></label>
        <label>Audience<input name="audience" placeholder="Who this targets" /></label>
      </div>
      <label>Goal<input name="goal" placeholder="e.g. 40 qualified leads" /></label>
      <div className="form-actions"><PendingButton label="Create campaign" /></div>
    </form>
  );
}
