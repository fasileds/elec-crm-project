"use client";

import { useActionState } from "react";
import { commentAction, requirementAction, taskAction } from "@/app/actions";
import { FormError, Idempotency, PendingButton } from "@/components/form";

export function TaskForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(taskAction, null);
  return (
    <form action={action} className="form">
      <FormError state={state} />
      <Idempotency />
      <input type="hidden" name="projectId" value={projectId} />
      <label>Title<input name="title" required /></label>
      <div className="form-row">
        <label>Priority<select name="priority" defaultValue="medium">{["low", "medium", "high", "critical"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Due<input name="dueOn" type="date" /></label>
      </div>
      <label>Estimate (minutes)<input name="estimatedMinutes" type="number" min={0} defaultValue={0} /></label>
      <label className="check"><input name="customerVisible" type="checkbox" /> Visible to the customer</label>
      <div className="form-actions"><PendingButton label="Create task" /></div>
    </form>
  );
}

export function RequirementForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(requirementAction, null);
  return (
    <form action={action} className="form">
      <p className="help">After scope is baselined, this becomes a change request instead of editing the original scope.</p>
      <FormError state={state} />
      <Idempotency />
      <input type="hidden" name="projectId" value={projectId} />
      <label>Title<input name="title" required /></label>
      <label>Description<textarea name="description" rows={4} /></label>
      <label>Acceptance criteria<textarea name="acceptance" rows={3} /></label>
      <div className="form-actions"><PendingButton label="Save requirement" /></div>
    </form>
  );
}

export function CommentForm({ projectId, entityId, customer }: { projectId: string; entityId: string; customer?: boolean }) {
  const [state, action] = useActionState(commentAction, null);
  return (
    <form action={action} className="form">
      <FormError state={state} />
      <Idempotency />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="entityType" value="project" />
      <input type="hidden" name="entityId" value={entityId} />
      <label>{customer ? "Message" : "Comment"}<textarea name="body" rows={3} required /></label>
      {customer ? (
        <div className="form-actions"><input type="hidden" name="visibility" value="customer" /><PendingButton label="Send to the team" /></div>
      ) : (
        <div className="row">
          <label className="check"><input type="checkbox" name="visibility" value="customer" /> Share with the customer</label>
          <PendingButton label="Post comment" />
        </div>
      )}
    </form>
  );
}
