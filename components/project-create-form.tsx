"use client";

import { useActionState } from "react";
import { projectAction } from "@/app/actions";
import { FormError, Idempotency, PendingButton } from "@/components/form";
import { PROJECT_TYPES } from "@/lib/domain/srs/catalog";

export function ProjectCreateForm({ customers, customerId }: { customers: Array<{ id: string; name: string; code: string }>; customerId?: string }) {
  const [state, action] = useActionState(projectAction, null);
  return (
    <form className="card grid" action={action} style={{ maxWidth: 760 }}>
      <FormError state={state} />
      <Idempotency />
      <label>Customer
        <select name="customerId" required defaultValue={customerId ?? ""}>
          <option value="">Choose a customer</option>
          {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} ({customer.code})</option>)}
        </select>
      </label>
      <label>Project name<input name="name" required /></label>
      <label>Summary<textarea name="summary" /></label>
      <label>Objectives<textarea name="objectives" /></label>
      <label>Initial scope<textarea name="scope" /></label>
      <label>Project type
        <select name="projectType" defaultValue="custom">{PROJECT_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <span className="help">Selects the SRS template. A draft SRS is created with the project.</span>
      </label>
      <label>Priority<select name="priority" defaultValue="medium">{["low", "medium", "high", "critical"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Target date<input name="dueOn" type="date" /></label>
      <PendingButton label="Create project" />
    </form>
  );
}
