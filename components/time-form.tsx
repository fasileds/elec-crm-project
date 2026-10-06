"use client";

import { useActionState } from "react";
import { timeAction } from "@/app/actions";
import { FormError, PendingButton } from "@/components/form";

export function TimeForm({ projects, today }: { projects: Array<{ id: string; name: string }>; today?: string }) {
  const [state, action] = useActionState(timeAction, null);
  return (
    <form className="form" action={action}>
      <FormError state={state} />
      <label>Project
        <select name="projectId" required defaultValue="">
          <option value="">Choose a project</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      <div className="form-row">
        <label>Date<input name="workOn" type="date" required defaultValue={today} max={today} /></label>
        <label>Minutes<input name="minutes" type="number" min={1} max={720} required placeholder="e.g. 90" /></label>
      </div>
      <label>Note<textarea name="note" rows={3} placeholder="What was the time spent on?" /></label>
      <div className="form-actions"><PendingButton label="Record time" /></div>
    </form>
  );
}
