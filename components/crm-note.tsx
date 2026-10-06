"use client";

import { useActionState } from "react";
import { commentAction } from "@/app/actions";
import { FormError, Idempotency, PendingButton } from "@/components/form";

export function CrmNoteForm({ entityType, entityId }: { entityType: "lead" | "opportunity"; entityId: string }) {
  const [state, action] = useActionState(commentAction, null);
  return (
    <form action={action} className="form">
      <FormError state={state} />
      <Idempotency />
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="visibility" value="internal" />
      <label><span className="sr-only">Internal note</span><textarea name="body" required rows={3} placeholder="Write an internal note. Visible to your company, never to the customer." /></label>
      <div className="form-actions"><PendingButton label="Post note" /></div>
    </form>
  );
}
