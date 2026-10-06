"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { autosaveAnswer } from "@/app/srs-actions";

type Question = { key: string; label: string; help?: string; type: "text" | "longtext" | "list" | "choice"; options?: string[]; required: boolean };
type Step = { key: string; title: string; intro: string; questions: Question[] };
type Answer = { value: string; version: number; origin: string; by: string; at: string };
type Status = "idle" | "dirty" | "saving" | "saved" | "failed" | "conflict" | "offline";
type Conflict = { value: string; version: number; by: string };

const DELAY = 1200;

function storageKey(docId: string, key: string) {
  return `srs:${docId}:${key}`;
}

function QuestionField({ docId, question, initial, editable, origin, onState }: { docId: string; question: Question; initial?: Answer; editable: boolean; origin: string; onState: (key: string, status: Status, answered: boolean) => void }) {
  const [value, setValue] = useState(initial?.value ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [restored, setRestored] = useState(false);
  const version = useRef(initial?.version ?? 0);
  const latest = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);
  const inFlight = useRef(false);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const schedule = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveRef.current(), ms);
  }, []);

  const save = useCallback(async () => {
    if (inFlight.current) {
      schedule(400);
      return;
    }
    inFlight.current = true;
    const sent = latest.current;
    setStatus("saving");
    try {
      const result = await autosaveAnswer(docId, question.key, sent, version.current, origin);
      if (result.ok) {
        version.current = result.version;
        attempts.current = 0;
        if (latest.current === sent) {
          window.localStorage.removeItem(storageKey(docId, question.key));
          setStatus("saved");
          setMessage("");
        } else {
          setStatus("dirty");
          schedule(DELAY);
        }
      } else if ("conflict" in result) {
        setConflict({ value: result.value, version: result.version, by: result.by });
        setStatus("conflict");
      } else {
        setStatus("failed");
        setMessage(result.error);
        if (!result.auth && attempts.current < 6) {
          attempts.current += 1;
          schedule(Math.min(30000, 2000 * 2 ** attempts.current));
        }
      }
    } catch {
      setStatus(navigator.onLine ? "failed" : "offline");
      setMessage(navigator.onLine ? "Could not reach the server. Retrying…" : "You are offline. Your text is kept on this device and will save when you reconnect.");
      if (attempts.current < 6) {
        attempts.current += 1;
        schedule(Math.min(30000, 2000 * 2 ** attempts.current));
      }
    } finally {
      inFlight.current = false;
    }
  }, [docId, question.key, origin, schedule]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    const raw = window.localStorage.getItem(storageKey(docId, question.key));
    if (!raw) return;
    try {
      const backup = JSON.parse(raw) as { value: string; version: number };
      if (backup.value !== (initial?.value ?? "") && backup.version === (initial?.version ?? 0)) {
        latest.current = backup.value;
        queueMicrotask(() => {
          setValue(backup.value);
          setRestored(true);
          setStatus("dirty");
        });
        schedule(300);
      } else window.localStorage.removeItem(storageKey(docId, question.key));
    } catch {
      window.localStorage.removeItem(storageKey(docId, question.key));
    }
  }, [docId, question.key, initial?.value, initial?.version, schedule]);

  useEffect(() => {
    const online = () => {
      if (latest.current !== (initial?.value ?? "") && status !== "saved" && status !== "conflict") {
        attempts.current = 0;
        void save();
      }
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [save, status, initial?.value]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    onState(question.key, status, Boolean(value.trim()));
  }, [onState, question.key, status, value]);

  function change(next: string) {
    setValue(next);
    latest.current = next;
    setStatus("dirty");
    window.localStorage.setItem(storageKey(docId, question.key), JSON.stringify({ value: next, version: version.current, at: Date.now() }));
    schedule(DELAY);
  }

  function resolve(keep: "mine" | "theirs") {
    if (!conflict) return;
    version.current = conflict.version;
    if (keep === "theirs") {
      setValue(conflict.value);
      latest.current = conflict.value;
      window.localStorage.removeItem(storageKey(docId, question.key));
      setStatus("saved");
    } else void save();
    setConflict(null);
  }

  const id = `q-${question.key}`;
  const label = { idle: initial?.by ? `Last saved by ${initial.by}` : "", dirty: "Unsaved changes", saving: "Saving…", saved: "Saved", failed: message || "Save failed — retrying", offline: message, conflict: "Edited elsewhere" }[status];
  return (
    <div className="wizard-q">
      <label htmlFor={id}>
        <span className="wizard-label">
          {question.label}
          {question.required ? <span className="req" aria-label="required">Required</span> : null}
        </span>
        {question.help ? <span className="help">{question.help}</span> : null}
      </label>
      {question.type === "choice" ? (
        <select id={id} value={value} onChange={(e) => change(e.target.value)} disabled={!editable}>
          <option value="">Choose…</option>
          {question.options?.map((option) => <option key={option}>{option}</option>)}
        </select>
      ) : question.type === "text" ? (
        <input id={id} value={value} onChange={(e) => change(e.target.value)} disabled={!editable} maxLength={12000} />
      ) : (
        <textarea id={id} value={value} onChange={(e) => change(e.target.value)} disabled={!editable} rows={question.type === "list" ? 5 : 4} maxLength={12000} placeholder={question.type === "list" ? "One item per line" : undefined} />
      )}
      <div className={`save-state ${status}`} role="status" aria-live="polite">
        {label}
        {restored && status !== "saved" ? " · restored unsaved text from this device" : ""}
        {status === "failed" || status === "offline" ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { attempts.current = 0; void save(); }}>Retry now</button>
        ) : null}
      </div>
      {conflict ? (
        <div className="alert warn conflict">
          <strong>{conflict.by || "Someone else"} changed this answer while you were editing.</strong>
          <p className="meta" style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>Their version: {conflict.value || "(empty)"}</p>
          <div className="btn-group">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => resolve("theirs")}>Use their version</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => resolve("mine")}>Keep mine</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SrsWizard({ docId, steps, answers, stepKey, editable, customer, baseHref, lockedReason }: { docId: string; steps: Step[]; answers: Record<string, Answer>; stepKey: string; editable: boolean; customer: boolean; baseHref: string; lockedReason?: string }) {
  const index = Math.max(0, steps.findIndex((s) => s.key === stepKey));
  const step = steps[index];
  const [origin, setOrigin] = useState(customer ? "client_input" : "elec_proposal");
  const [states, setStates] = useState<Record<string, { status: Status; answered: boolean }>>({});
  const onState = useCallback((key: string, status: Status, answered: boolean) => {
    setStates((current) => (current[key]?.status === status && current[key]?.answered === answered ? current : { ...current, [key]: { status, answered } }));
  }, []);
  const required = steps.flatMap((s) => s.questions.filter((q) => q.required));
  const answered = required.filter((q) => states[q.key]?.answered ?? Boolean(answers[q.key]?.value.trim())).length;
  const pending = Object.values(states).some((s) => ["dirty", "saving", "failed", "offline", "conflict"].includes(s.status));
  const href = (key: string) => `${baseHref}&tab=wizard&step=${key}`;

  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  return (
    <div className="wizard">
      <nav className="wizard-steps" aria-label="Wizard steps">
        <div className="wizard-progress" aria-label={`${answered} of ${required.length} required answers`}>
          <span style={{ width: `${required.length ? Math.round((answered / required.length) * 100) : 100}%` }} />
        </div>
        <p className="meta">{answered} of {required.length} required answers</p>
        <ol>
          {steps.map((s, i) => {
            const req = s.questions.filter((q) => q.required);
            const done = req.length > 0 && req.every((q) => states[q.key]?.answered ?? Boolean(answers[q.key]?.value.trim()));
            return (
              <li key={s.key}>
                <Link href={href(s.key)} aria-current={s.key === step.key ? "step" : undefined} className={done ? "done" : undefined}>
                  <span className="num">{i + 1}</span>
                  {s.title}
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
      <section className="wizard-body">
        <header>
          <p className="kicker">Step {index + 1} of {steps.length}</p>
          <h2>{step.title}</h2>
          <p className="lede">{step.intro}</p>
        </header>
        {lockedReason ? <p className="alert warn">{lockedReason}</p> : null}
        {!customer && editable ? (
          <div className="seg" role="radiogroup" aria-label="Whose words are these?">
            <span className="meta">You are entering:</span>
            <label><input type="radio" name="origin" checked={origin === "client_input"} onChange={() => setOrigin("client_input")} /> The client&apos;s words</label>
            <label><input type="radio" name="origin" checked={origin === "elec_proposal"} onChange={() => setOrigin("elec_proposal")} /> An Elec Nova proposal</label>
            <label><input type="radio" name="origin" checked={origin === "assumption"} onChange={() => setOrigin("assumption")} /> An assumption</label>
          </div>
        ) : null}
        {step.questions.length === 0 ? <p className="meta">This step has no questions. Use the links below to continue.</p> : null}
        {step.questions.map((question) => (
          <QuestionField key={question.key} docId={docId} question={question} initial={answers[question.key]} editable={editable} origin={origin} onState={onState} />
        ))}
        <footer className="wizard-nav">
          {index > 0 ? <Link className="btn btn-secondary" href={href(steps[index - 1].key)}>Back</Link> : <span />}
          <span className="meta">{pending ? "Saving your answers…" : "All changes saved"}</span>
          {index < steps.length - 1 ? <Link className="btn btn-primary" href={href(steps[index + 1].key)}>Next: {steps[index + 1].title}</Link> : null}
        </footer>
      </section>
    </div>
  );
}
