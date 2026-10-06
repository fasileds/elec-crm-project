"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { SectionConfig, TemplateConfig } from "@/lib/domain/srs/catalog";

export function TemplateEditor({ initial, kinds }: { initial: TemplateConfig; kinds: Array<[string, string]> }) {
  const [sections, setSections] = useState<SectionConfig[]>(initial.sections);
  const [approval, setApproval] = useState(initial.approval);
  const [styling, setStyling] = useState(initial.styling);
  const [requiredKinds, setRequiredKinds] = useState<string[]>(initial.requiredKinds);
  const [steps, setSteps] = useState(JSON.stringify(initial.steps, null, 2));
  const [stepsError, setStepsError] = useState("");
  const groups = useMemo(() => [...new Set(sections.map((s) => s.group))], [sections]);

  const config = useMemo(() => {
    try {
      return JSON.stringify({ sections, steps: JSON.parse(steps), requiredKinds, approval, styling });
    } catch {
      return "";
    }
  }, [sections, steps, requiredKinds, approval, styling]);

  const update = (index: number, patch: Partial<SectionConfig>) => setSections((list) => list.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const move = (index: number, by: number) =>
    setSections((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
      return next;
    });

  return (
    <div className="stack">
      <input type="hidden" name="config" value={config} />
      <div className="table-wrap">
        <table className="tpl-table">
          <thead><tr><th>Order</th><th>Section title</th><th>Group</th><th>Required</th><th>Item types shown</th><th /></tr></thead>
          <tbody>
            {sections.map((section, index) => (
              <tr key={`${section.key}-${index}`}>
                <td className="nowrap">
                  <button type="button" className="btn btn-ghost btn-sm" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></button>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label="Move down" disabled={index === sections.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></button>
                </td>
                <td><input aria-label="Section title" value={section.title} onChange={(e) => update(index, { title: e.target.value })} /><div className="meta">{section.key}</div></td>
                <td>
                  <input aria-label="Group" list="tpl-groups" value={section.group} onChange={(e) => update(index, { group: e.target.value })} />
                </td>
                <td><input type="checkbox" aria-label="Required" checked={section.required} onChange={(e) => update(index, { required: e.target.checked })} /></td>
                <td className="meta">{(section.kinds ?? []).map((k) => kinds.find(([key]) => key === k)?.[1] ?? k).join(", ") || "Narrative"}</td>
                <td><button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${section.title}`} disabled={["functional", "sign_off"].includes(section.key)} onClick={() => setSections((list) => list.filter((_, i) => i !== index))}><Trash2 size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="tpl-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      </div>
      <div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            const base = `custom_${sections.length + 1}`;
            setSections((list) => [...list, { key: base, title: "New section", group: groups.at(-1) ?? "Other", required: false }]);
          }}
        >
          <Plus size={14} /> Add section
        </button>
      </div>

      <div className="dash-pair">
        <fieldset className="form">
          <legend>Approval workflow</legend>
          <label>Client signatures required<input type="number" min={0} max={10} value={approval.clientSigners} onChange={(e) => setApproval({ ...approval, clientSigners: Number(e.target.value) })} /></label>
          <label>Elec Novatech signatures required<input type="number" min={1} max={10} value={approval.companySigners} onChange={(e) => setApproval({ ...approval, companySigners: Number(e.target.value) })} /></label>
          <label>Approval statement<textarea rows={4} value={approval.statement} onChange={(e) => setApproval({ ...approval, statement: e.target.value })} /></label>
        </fieldset>
        <fieldset className="form">
          <legend>Document styling</legend>
          <label>Accent colour<input type="color" value={styling.accent} onChange={(e) => setStyling({ ...styling, accent: e.target.value })} /></label>
          <label>Footer text<input value={styling.footer} onChange={(e) => setStyling({ ...styling, footer: e.target.value })} /></label>
          <label>Default classification<input value={styling.confidentiality} onChange={(e) => setStyling({ ...styling, confidentiality: e.target.value })} /></label>
          <div>
            <span className="help">Item types every SRS must contain before approval</span>
            <div className="chip-grid">
              {kinds.map(([key, label]) => (
                <label key={key} className="chip-check"><input type="checkbox" checked={requiredKinds.includes(key)} onChange={(e) => setRequiredKinds((list) => (e.target.checked ? [...list, key] : list.filter((k) => k !== key)))} /> {label}</label>
              ))}
            </div>
          </div>
        </fieldset>
      </div>

      <details className="advanced">
        <summary>Wizard steps and questions (advanced)</summary>
        <p className="help">Each question names the section it fills (<code>section</code>) and may turn each answer line into an item (<code>generates</code>). The template is validated when you save.</p>
        <textarea
          rows={18}
          spellCheck={false}
          className="mono"
          value={steps}
          onChange={(e) => {
            setSteps(e.target.value);
            try {
              JSON.parse(e.target.value);
              setStepsError("");
            } catch {
              setStepsError("This is not valid JSON yet.");
            }
          }}
        />
        {stepsError ? <p className="alert bad">{stepsError}</p> : null}
      </details>
    </div>
  );
}
