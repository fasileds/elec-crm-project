"use client";

import { useActionState } from "react";
import { leadAction } from "@/app/actions";
import { FormError, Idempotency, PendingButton } from "@/components/form";

export function LeadForm({ campaigns = [] }: { campaigns?: Array<{ id: string; name: string }> }) {
  const [state, action] = useActionState(leadAction, null);
  return (
    <form className="form" action={action}>
      <FormError state={state} />
      <Idempotency />
      <label>Contact name<input name="name" required autoComplete="off" /></label>
      <div className="form-row">
        <label>Company<input name="company" placeholder="Leave blank for an individual" /></label>
        <label>Industry<input name="industry" /></label>
      </div>
      <div className="form-row">
        <label>Email<input name="email" type="email" /></label>
        <label>Phone<input name="phone" type="tel" placeholder="+1 555 0100" /></label>
      </div>
      <div className="form-row">
        <label>Source<select name="source" defaultValue="website">{["website", "referral", "outbound", "event", "partner", "other"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Priority<select name="priority" defaultValue="medium">{["low", "medium", "high", "critical"].map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      <div className="form-row">
        <label>Estimated value<input name="estimatedValue" inputMode="decimal" placeholder="0.00" /></label>
        <label>Location<input name="location" placeholder="City, country" /></label>
      </div>
      {campaigns.length ? (
        <label>Campaign<select name="campaignId" defaultValue=""><option value="">None</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
      ) : null}
      <p className="help">You become the owner. A matching email on an existing lead or contact is refused so duplicates are not created.</p>
      <div className="form-actions"><PendingButton label="Create lead" /></div>
    </form>
  );
}
