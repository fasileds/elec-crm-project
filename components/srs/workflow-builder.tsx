"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

type Step = { type: "step" | "decision"; actor: string; action: string; input: string; output: string; exception: string; yes?: string; no?: string };

const blank = (): Step => ({ type: "step", actor: "", action: "", input: "", output: "", exception: "", yes: "", no: "" });

export function WorkflowBuilder({ initial, disabled }: { initial: Step[]; disabled?: boolean }) {
  const [steps, setSteps] = useState<Step[]>(initial.length ? initial : [blank()]);
  const update = (index: number, patch: Partial<Step>) => setSteps((list) => list.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  const move = (index: number, by: number) =>
    setSteps((list) => {
      const next = [...list];
      const [step] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + by)), 0, step);
      return next;
    });

  return (
    <div className="wf-builder">
      <input type="hidden" name="steps" value={JSON.stringify(steps.filter((s) => s.action.trim()))} />
      <ol className="wf-list">
        {steps.map((step, index) => (
          <li key={index} className={step.type === "decision" ? "wf-step decision" : "wf-step"}>
            <div className="wf-head">
              <span className="num">{index + 1}</span>
              <select aria-label="Step type" value={step.type} disabled={disabled} onChange={(e) => update(index, { type: e.target.value as Step["type"] })}>
                <option value="step">Step</option>
                <option value="decision">Decision</option>
              </select>
              <input aria-label="Actor" placeholder="Who" value={step.actor} disabled={disabled} onChange={(e) => update(index, { actor: e.target.value })} />
              <span className="btn-group">
                <button type="button" className="btn btn-ghost btn-sm" aria-label="Move up" disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></button>
                <button type="button" className="btn btn-ghost btn-sm" aria-label="Move down" disabled={disabled || index === steps.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></button>
                <button type="button" className="btn btn-ghost btn-sm" aria-label="Remove step" disabled={disabled || steps.length === 1} onClick={() => setSteps((list) => list.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
              </span>
            </div>
            <input aria-label="Action" placeholder={step.type === "decision" ? "Question to decide, e.g. Is the order over $500?" : "What happens"} value={step.action} disabled={disabled} onChange={(e) => update(index, { action: e.target.value })} />
            <div className="wf-grid">
              <input aria-label="Input" placeholder="Input" value={step.input} disabled={disabled} onChange={(e) => update(index, { input: e.target.value })} />
              <input aria-label="Output" placeholder="Output" value={step.output} disabled={disabled} onChange={(e) => update(index, { output: e.target.value })} />
              {step.type === "decision" ? (
                <>
                  <input aria-label="If yes go to step" placeholder="Yes → step #" value={step.yes ?? ""} disabled={disabled} onChange={(e) => update(index, { yes: e.target.value })} />
                  <input aria-label="If no go to step" placeholder="No → step #" value={step.no ?? ""} disabled={disabled} onChange={(e) => update(index, { no: e.target.value })} />
                </>
              ) : (
                <input aria-label="Exception" placeholder="If it fails…" value={step.exception} disabled={disabled} onChange={(e) => update(index, { exception: e.target.value })} className="span2" />
              )}
            </div>
          </li>
        ))}
      </ol>
      {!disabled ? (
        <div className="btn-group">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSteps((list) => [...list, blank()])}><Plus size={14} /> Add step</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSteps((list) => [...list, { ...blank(), type: "decision" }])}><Plus size={14} /> Add decision</button>
        </div>
      ) : null}
    </div>
  );
}
