"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AppError, validationError } from "@/lib/errors";
import { currentActor, requireEmployee, requireUser } from "@/lib/session";
import { parseMoneyToCents } from "@/lib/money";
import { createSrs, updateSrsSettings } from "@/lib/domain/srs/core";
import { addCriterion, convertItem, createItem, deleteItem, generateFromAnswers, linkItem, removeCriterion, saveAnswer, setNfrApplicability, setPrefillOverride, setQaStatus, transitionItem, updateItem, updateSection } from "@/lib/domain/srs/content";
import { addSrsComment, assessChangeRequest, decideChangeRequest, resolveSrsComment, signSrs, startRevision, submitChangeRequest, transitionSrs } from "@/lib/domain/srs/workflow";
import { saveTemplateVersion } from "@/lib/domain/srs/templates";
import { startProjectFromOpportunity } from "@/lib/domain/projects";
import { KINDS } from "@/lib/domain/srs/catalog";

function back(formData: FormData) {
  const value = String(formData.get("back") ?? "");
  return /^\/(projects|portal\/projects|settings)\//.test(value) && !value.includes("//") ? value : "/projects";
}

function withParam(url: string, key: string, value: string) {
  const [path, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.delete("error");
  params.delete("notice");
  params.set(key, value);
  return `${path}?${params.toString()}`;
}

const s = (formData: FormData, key: string) => String(formData.get(key) ?? "");
const n = (formData: FormData, key: string) => Number(formData.get(key) ?? 0);

function itemData(formData: FormData, kind: string) {
  const data: Record<string, unknown> = {};
  for (const field of KINDS[kind]?.fields ?? []) data[field.key] = s(formData, `data.${field.key}`);
  if (kind === "workflow") {
    try {
      data.steps = JSON.parse(s(formData, "steps") || "[]");
    } catch {
      data.steps = [];
    }
  }
  return data;
}

export async function srsAction(formData: FormData) {
  const actor = await requireUser();
  const intent = s(formData, "intent");
  const doc = s(formData, "doc");
  let target = back(formData);
  let notice = "";
  try {
    switch (intent) {
      case "create": {
        const created = await createSrs(actor, s(formData, "projectId"), { mode: s(formData, "mode") === "separate" ? "separate" : "continue", reason: s(formData, "reason") });
        target = withParam(target, "doc", created.id);
        notice = created.existing ? "Opened the existing SRS." : "SRS draft created.";
        break;
      }
      case "settings":
        await updateSrsSettings(actor, doc, { clientAccess: formData.has("clientAccess") ? s(formData, "clientAccess") === "on" : undefined, confidentiality: formData.has("confidentiality") ? s(formData, "confidentiality") : undefined, version: n(formData, "version") });
        notice = "Settings saved.";
        break;
      case "transition":
        await transitionSrs(actor, doc, s(formData, "to"), { version: n(formData, "version"), note: s(formData, "note") });
        notice = "Status updated.";
        break;
      case "revision":
        await startRevision(actor, doc, { reason: s(formData, "reason"), version: n(formData, "version") });
        notice = "Revision opened. The approved version stays unchanged.";
        break;
      case "section":
        await updateSection(actor, doc, s(formData, "key"), {
          content: formData.has("content") ? s(formData, "content") : undefined,
          title: formData.has("title") ? s(formData, "title") : undefined,
          applicable: formData.has("applicable") ? s(formData, "applicable") !== "no" : undefined,
          naReason: s(formData, "naReason"),
          visibility: formData.has("visibility") ? s(formData, "visibility") : undefined,
          origin: formData.has("origin") ? s(formData, "origin") : undefined,
          version: n(formData, "version"),
        });
        notice = "Section saved.";
        break;
      case "override":
        await setPrefillOverride(actor, doc, s(formData, "key"), formData.has("clear") ? null : s(formData, "text"), n(formData, "version"));
        notice = "Prefilled text updated.";
        break;
      case "nfr":
        await setNfrApplicability(actor, doc, s(formData, "category"), { applicable: s(formData, "applicable") === "yes", reason: s(formData, "reason"), version: n(formData, "version") });
        notice = "Quality category updated.";
        break;
      case "generate": {
        const result = await generateFromAnswers(actor, doc);
        notice = result.created ? `Created ${result.created} draft item${result.created === 1 ? "" : "s"} from the answers. Review each one before approval.` : "Nothing new to structure — every listed answer already has an item.";
        break;
      }
      case "item.create": {
        const kind = s(formData, "kind");
        const created = await createItem(actor, doc, { kind, title: s(formData, "title"), description: s(formData, "description"), priority: s(formData, "priority"), origin: s(formData, "origin"), visibility: s(formData, "visibility"), ownerId: s(formData, "ownerId") || null, data: itemData(formData, kind) });
        target = withParam(target, "item", created!.id);
        notice = `${created!.key} created.`;
        break;
      }
      case "item.update": {
        const kind = s(formData, "kind");
        await updateItem(actor, s(formData, "item"), { title: s(formData, "title"), description: s(formData, "description"), priority: s(formData, "priority"), origin: s(formData, "origin"), visibility: formData.has("visibility") ? s(formData, "visibility") : undefined, ownerId: s(formData, "ownerId") || null, data: itemData(formData, kind), version: n(formData, "version"), reason: s(formData, "reason") });
        notice = "Saved.";
        break;
      }
      case "item.transition":
        await transitionItem(actor, s(formData, "item"), s(formData, "to"), n(formData, "version"), s(formData, "note"));
        notice = "Status updated.";
        break;
      case "item.delete":
        await deleteItem(actor, s(formData, "item"));
        target = withParam(target, "item", "");
        notice = "Item deleted.";
        break;
      case "criterion.add":
        await addCriterion(actor, s(formData, "item"), { given: s(formData, "given"), when: s(formData, "when"), then: s(formData, "then") });
        notice = "Acceptance criterion added.";
        break;
      case "criterion.remove":
        await removeCriterion(actor, s(formData, "criterion"));
        notice = "Acceptance criterion removed.";
        break;
      case "qa":
        await setQaStatus(actor, s(formData, "criterion"), { status: s(formData, "status"), evidence: s(formData, "evidence"), version: n(formData, "version") });
        notice = "Test result recorded.";
        break;
      case "link":
        await linkItem(actor, s(formData, "item"), { targetType: s(formData, "targetType"), targetId: s(formData, "targetId") });
        notice = "Linked.";
        break;
      case "convert": {
        const result = await convertItem(actor, s(formData, "item"), s(formData, "target") === "milestone" ? "milestone" : "task");
        notice = result.existing ? "Already linked to delivery work." : `Created a ${s(formData, "target") === "milestone" ? "milestone" : "task"} linked to this requirement.`;
        break;
      }
      case "comment":
        await addSrsComment(actor, doc, { body: s(formData, "body"), targetType: s(formData, "targetType"), targetKey: s(formData, "targetKey"), parentId: s(formData, "parentId") || null, visibility: s(formData, "visibility"), kind: s(formData, "kind"), attachmentIds: formData.getAll("attachments").map(String).filter(Boolean) });
        notice = s(formData, "kind") === "clarification" ? "Clarification requested." : "Comment posted.";
        break;
      case "comment.resolve":
        await resolveSrsComment(actor, s(formData, "comment"));
        notice = "Thread resolved.";
        break;
      case "change.create": {
        const cost = s(formData, "cost");
        const created = await submitChangeRequest(actor, doc, {
          title: s(formData, "title"),
          reason: s(formData, "reason"),
          classification: s(formData, "classification"),
          affectedKeys: s(formData, "keys").split(/[\s,]+/).filter(Boolean),
          scopeImpact: s(formData, "scopeImpact"),
          timelineImpact: s(formData, "timelineImpact"),
          effortImpact: s(formData, "effortImpact"),
          commercialImpact: s(formData, "commercialImpact"),
          risks: s(formData, "risks"),
          estimatedMinutes: Math.round(Number(s(formData, "hours") || 0) * 60),
          estimatedCostCents: cost ? parseMoneyToCents(cost) : null,
        });
        notice = `${created.code} submitted.`;
        break;
      }
      case "change.assess": {
        const cost = s(formData, "cost");
        await assessChangeRequest(actor, s(formData, "change"), {
          classification: s(formData, "classification"),
          scopeImpact: s(formData, "scopeImpact"),
          timelineImpact: s(formData, "timelineImpact"),
          effortImpact: s(formData, "effortImpact"),
          commercialImpact: s(formData, "commercialImpact"),
          risks: s(formData, "risks"),
          estimatedMinutes: Math.round(Number(s(formData, "hours") || 0) * 60),
          estimatedCostCents: cost ? parseMoneyToCents(cost) : null,
          note: s(formData, "note"),
          version: n(formData, "version"),
        });
        notice = "Assessment saved.";
        break;
      }
      case "change.decide":
        await decideChangeRequest(actor, s(formData, "change"), { decision: s(formData, "decision") === "approved" ? "approved" : "rejected", note: s(formData, "note"), version: n(formData, "version") });
        notice = "Decision recorded.";
        break;
      case "sign": {
        const head = await headers();
        const result = await signSrs(actor, doc, {
          versionId: s(formData, "versionId"),
          decision: s(formData, "decision") === "rejected" ? "rejected" : "approved",
          typedName: s(formData, "typedName"),
          drawing: s(formData, "drawing") || null,
          comment: s(formData, "comment"),
          accept: s(formData, "accept") === "on",
          ipAddress: head.get("x-forwarded-for")?.split(",")[0]?.trim() || head.get("x-real-ip") || "",
          userAgent: head.get("user-agent") ?? "",
        });
        notice = result.outcome === "approved" ? "Approved. The signed version is now the baseline." : result.outcome === "rejected" ? "Changes requested. The team has been notified." : "Your approval is recorded. Waiting for the remaining signers.";
        break;
      }
      default:
        throw validationError("Unknown action.");
    }
  } catch (error) {
    if (typeof error === "object" && error && "digest" in error && String((error as { digest?: string }).digest).includes("NEXT_REDIRECT")) throw error;
    const message = error instanceof AppError ? error.message : "Something went wrong. Nothing was saved.";
    if (!(error instanceof AppError)) console.error(error);
    redirect(withParam(target, "error", message));
  }
  revalidatePath(target.split("?")[0]);
  redirect(notice ? withParam(target, "notice", notice) : target);
}

export type AutosaveResult =
  | { ok: true; version: number; savedAt: string }
  | { ok: false; conflict: true; value: string; version: number; by: string }
  | { ok: false; error: string; auth?: boolean };

export async function autosaveAnswer(documentId: string, questionKey: string, value: string, expectedVersion: number, origin: string): Promise<AutosaveResult> {
  const actor = await currentActor();
  if (!actor) return { ok: false, error: "Your session expired. Your text is kept on this device — sign in again to save it.", auth: true };
  try {
    const result = await saveAnswer(actor, documentId, { questionKey, value, expectedVersion, origin: actor.kind === "customer" ? "client_input" : origin });
    if (result.ok) return { ok: true, version: result.version, savedAt: result.updatedAt };
    return { ok: false, conflict: true, value: result.current.value, version: result.current.version, by: result.current.updatedByName };
  } catch (error) {
    return { ok: false, error: error instanceof AppError ? error.message : "Could not save. We will retry." };
  }
}

export async function templateAction(formData: FormData) {
  const actor = await requireEmployee();
  const id = s(formData, "id");
  const target = `/settings/srs-templates/${id}`;
  try {
    await saveTemplateVersion(actor, id, { config: JSON.parse(s(formData, "config")), note: s(formData, "note"), expectedVersion: n(formData, "version"), active: formData.has("active") ? s(formData, "active") === "on" : undefined });
  } catch (error) {
    const message = error instanceof AppError ? error.message : error instanceof SyntaxError ? "The template could not be read. Check the advanced JSON." : "Something went wrong. Nothing was saved.";
    redirect(`${target}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(target);
  redirect(`${target}?notice=${encodeURIComponent("Saved as a new template version. Existing SRS documents keep the version they were created from.")}`);
}

export async function startProjectAction(formData: FormData) {
  const actor = await requireEmployee();
  const opportunityId = s(formData, "opportunityId");
  let projectId = "";
  try {
    const result = await startProjectFromOpportunity(actor, opportunityId, { name: s(formData, "name"), projectType: s(formData, "projectType"), dueOn: s(formData, "dueOn") || undefined, idempotencyKey: s(formData, "idempotencyKey") });
    projectId = result.id;
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Something went wrong. Nothing was saved.";
    redirect(`/opportunities/${opportunityId}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/projects/${projectId}/srs`);
}
