"use client";

import { useActionState } from "react";
import { routingRuleAction } from "@/app/actions";
import { FormError, PendingButton } from "@/components/form";

export function RoutingForm({ people }: { people: Array<{ id: string; name: string }> }) {
  const [state, action] = useActionState(routingRuleAction, null);
  return (
    <form action={action} className="form">
      <p className="help">A matching rule assigns an active employee and records why. If nobody on the rule is available, the lead stays in the unassigned queue.</p>
      <FormError state={state} />
      <label>Rule name<input name="name" required placeholder="e.g. Website leads to inbound team" /></label>
      <div className="form-row">
        <label>Strategy<select name="strategy" defaultValue="round_robin"><option value="round_robin">Round robin</option><option value="first_available">First available</option></select></label>
        <label>Source match<input name="source" placeholder="Any" /></label>
      </div>
      <label>Industry match<input name="industry" placeholder="Any" /></label>
      <label>Employees<select name="userIds" multiple required size={Math.min(6, Math.max(people.length, 2))}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
      <div className="form-actions"><PendingButton label="Save rule" /></div>
    </form>
  );
}
