import { createHash } from "node:crypto";
import type { Db } from "@/lib/domain/support";
import { KINDS, NFR_CATEGORIES, ORIGIN_LABELS, PRIORITY_LABELS, QA_LABELS, SRS_STATUS_LABELS, allQuestions, projectTypeLabel, type Origin, type SrsStatus, type TemplateConfig } from "@/lib/domain/srs/catalog";
import { parseTemplateConfig } from "@/lib/domain/srs/templates";
import { versionLabel } from "@/lib/domain/srs/core";
import type { WorkflowStep } from "@/lib/domain/srs/content";

export type DocCriterion = { given: string; when: string; then: string; qa: string };
export type DocItem = {
  key: string;
  kind: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  origin: string;
  fields: Array<[string, string]>;
  criteria: DocCriterion[];
  steps?: WorkflowStep[];
};
export type DocBlock =
  | { type: "text"; text: string; caption?: string }
  | { type: "items"; kind: string; title: string; items: DocItem[] }
  | { type: "table"; caption?: string; columns: string[]; rows: string[][] }
  | { type: "notice"; text: string };
export type DocSection = { number: string; key: string; title: string; notApplicable?: string; blocks: DocBlock[] };
export type DocGroup = { number: string; title: string; sections: DocSection[] };
export type DocSigner = { side: string; name: string; role: string; decision: string; date: string; method: string; hash: string };
export type DocModel = {
  meta: {
    code: string;
    title: string;
    version: string;
    status: string;
    statusLabel: string;
    projectName: string;
    projectCode: string;
    projectType: string;
    preparedBy: string;
    preparedFor: string;
    createdOn: string;
    updatedOn: string;
    confidentiality: string;
    template: string;
    accent: string;
    footer: string;
  };
  revisions: Array<{ version: string; date: string; author: string; status: string; note: string }>;
  approval: { clientSigners: number; companySigners: number; statement: string; signatures: DocSigner[] };
  groups: DocGroup[];
};

const date = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : "");

function sharedItems<T extends { visibility: string; status: string }>(items: T[]) {
  return items.filter((item) => item.visibility === "shared" && item.status !== "deprecated" && item.status !== "rejected");
}

export async function loadDocInputs(db: Db, documentId: string) {
  const doc = await db.srsDocument.findUniqueOrThrow({ where: { id: documentId }, include: { templateVersion: { include: { template: true } } } });
  const [project, sections, answers, items, versions] = await Promise.all([
    db.project.findUniqueOrThrow({
      where: { id: doc.projectId },
      include: {
        customer: { include: { contacts: { where: { archivedAt: null }, orderBy: { isPrimary: "desc" }, take: 6 } } },
        manager: { select: { name: true, jobTitle: true } },
        members: { include: { user: { select: { name: true, jobTitle: true, status: true } } } },
        contacts: { include: { contact: true } },
        milestones: { where: { customerVisible: true }, orderBy: { dueOn: "asc" } },
      },
    }),
    db.srsSection.findMany({ where: { documentId }, orderBy: { sort: "asc" } }),
    db.srsAnswer.findMany({ where: { documentId } }),
    db.srsItem.findMany({ where: { documentId }, include: { criteria: { orderBy: { sort: "asc" } } }, orderBy: [{ kind: "asc" }, { seq: "asc" }] }),
    db.srsVersion.findMany({ where: { documentId }, orderBy: { seq: "asc" }, select: { id: true, label: true, status: true, kind: true, note: true, createdAt: true, createdByName: true, approvedAt: true } }),
  ]);
  const opportunity = project.opportunityId ? await db.opportunity.findUnique({ where: { id: project.opportunityId }, select: { requirements: true, notes: true, name: true } }) : null;
  return { doc, project, sections, answers, items, versions, opportunity, config: parseTemplateConfig(doc.templateVersion.config) };
}

type Inputs = Awaited<ReturnType<typeof loadDocInputs>>;

function itemToDoc(item: Inputs["items"][number]): DocItem {
  const meta = KINDS[item.kind];
  const data = JSON.parse(item.data || "{}") as Record<string, unknown>;
  const fields: Array<[string, string]> = [];
  for (const field of meta?.fields ?? []) {
    const value = data[field.key];
    if (value == null || value === "") continue;
    const text = field.type === "select" ? field.options?.find(([key]) => key === value)?.[1] ?? String(value) : String(value);
    fields.push([field.label, text]);
  }
  return {
    key: item.key,
    kind: item.kind,
    title: item.title,
    description: item.description,
    status: item.status,
    priority: item.priority,
    origin: item.origin,
    fields,
    criteria: item.criteria.map((c) => ({ given: c.given, when: c.whenText, then: c.thenText, qa: c.qaStatus })),
    steps: item.kind === "workflow" ? ((data.steps as WorkflowStep[] | undefined) ?? []) : undefined,
  };
}

function prefillText(key: string, inputs: Inputs): DocBlock[] {
  const { project, opportunity, items } = inputs;
  const overrides = JSON.parse(inputs.doc.overrides || "{}") as Record<string, string>;
  const section = inputs.config.sections.find((s) => s.key === key);
  if (overrides[key]) return [{ type: "text", text: overrides[key], caption: "Adjusted from the CRM record" }];
  switch (section?.prefill) {
    case "summary":
      return project.summary ? [{ type: "text", text: project.summary, caption: "From the project record" }] : [];
    case "objectives":
      return project.objectives ? [{ type: "text", text: project.objectives, caption: "From the project record" }] : [];
    case "scope":
      return project.scope ? [{ type: "text", text: project.scope, caption: "From the project record" }] : [];
    case "opportunity":
      return opportunity?.requirements ? [{ type: "text", text: opportunity.requirements, caption: "From the sales opportunity" }] : [];
    case "team": {
      const rows: string[][] = [];
      if (project.manager) rows.push([project.manager.name, "Elec Novatech PLC", "Project manager", "Delivery and change control"]);
      for (const member of project.members) {
        if (member.user.status !== "active" || member.user.name === project.manager?.name) continue;
        rows.push([member.user.name, "Elec Novatech PLC", member.user.jobTitle || member.role, member.role === "manager" ? "Delivery" : "Project team"]);
      }
      const contacts = project.contacts.length ? project.contacts.map((c) => ({ ...c.contact, role: c.role })) : project.customer.contacts.map((c) => ({ ...c, role: c.isPrimary ? "Primary contact" : c.role }));
      for (const contact of contacts) rows.push([contact.name, project.customer.name, contact.title || contact.role.replaceAll("_", " "), contact.role.replaceAll("_", " ")]);
      return rows.length ? [{ type: "table", caption: "From the CRM and project team", columns: ["Name", "Organization", "Role", "Responsibility"], rows }] : [];
    }
    case "milestones":
      return project.milestones.length
        ? [{ type: "table", caption: "From the project plan", columns: ["ID", "Milestone", "Target date", "Status"], rows: project.milestones.map((m) => [m.code, m.name, m.dueOn ?? "To be scheduled", m.status.replaceAll("_", " ")]) }]
        : [];
    case "testing": {
      const shared = sharedItems(items).filter((item) => item.criteria.length);
      if (!shared.length) return [];
      const count = (status: string) => shared.reduce((sum, item) => sum + item.criteria.filter((c) => c.qaStatus === status).length, 0);
      const total = shared.reduce((sum, item) => sum + item.criteria.length, 0);
      return [{ type: "table", caption: "Acceptance criteria status", columns: ["Criteria", "Passed", "Failed", "Blocked", "Pending", "N/A"], rows: [[String(total), String(count("passed")), String(count("failed")), String(count("blocked")), String(count("pending")), String(count("na"))]] }];
    }
    default:
      return [];
  }
}

export function buildDocModel(inputs: Inputs, options: { versionLabel?: string; status?: string; signatures?: DocSigner[] } = {}): DocModel {
  const { doc, project, config } = inputs;
  const sections = inputs.sections.filter((s) => s.visibility === "shared");
  const answers = inputs.answers;
  const items = sharedItems(inputs.items);
  const questions = allQuestions(config);
  const nfrNa = JSON.parse(doc.nfrNotApplicable || "{}") as Record<string, string>;
  const groupsOrder: string[] = [];
  for (const section of config.sections) if (!groupsOrder.includes(section.group)) groupsOrder.push(section.group);
  const configByKey = new Map(config.sections.map((s) => [s.key, s]));

  const groups: DocGroup[] = [];
  for (const [groupIndex, groupTitle] of groupsOrder.entries()) {
    const groupSections = sections.filter((s) => (configByKey.get(s.key)?.group ?? "Other") === groupTitle);
    if (!groupSections.length) continue;
    const number = String(groups.length + 1);
    void groupIndex;
    const out: DocSection[] = [];
    for (const section of groupSections) {
      const sectionConfig = configByKey.get(section.key);
      const docSection: DocSection = { number: `${number}.${out.length + 1}`, key: section.key, title: section.title, blocks: [] };
      if (!section.applicable) {
        docSection.notApplicable = section.naReason || "Not applicable to this project.";
        out.push(docSection);
        continue;
      }
      docSection.blocks.push(...prefillText(section.key, inputs));
      if (section.content.trim()) docSection.blocks.push({ type: "text", text: section.content, caption: section.origin === "client_input" ? ORIGIN_LABELS.client_input : section.origin === "elec_proposal" ? undefined : ORIGIN_LABELS[section.origin as Origin] });
      for (const question of questions.filter((q) => q.section === section.key)) {
        const answer = answers.find((a) => a.questionKey === question.key);
        if (!answer?.value.trim()) continue;
        if (question.generates && inputs.items.some((item) => item.sourceKey?.startsWith(`${question.key}:`))) continue;
        docSection.blocks.push({ type: "text", text: answer.value, caption: `${ORIGIN_LABELS[answer.origin as Origin] ?? "Response"} — ${question.label}` });
      }
      for (const kind of sectionConfig?.kinds ?? []) {
        const list = items.filter((item) => item.kind === kind);
        if (list.length) docSection.blocks.push({ type: "items", kind, title: KINDS[kind].plural, items: list.map(itemToDoc) });
      }
      if (section.key === "nonfunctional") {
        const rows = NFR_CATEGORIES.map(([key, label]) => {
          const count = items.filter((item) => item.kind === "nonfunctional" && (JSON.parse(item.data || "{}") as { category?: string }).category === key).length;
          return [label, nfrNa[key] ? "Not applicable" : count ? `${count} requirement${count === 1 ? "" : "s"}` : "Not yet specified", nfrNa[key] ?? ""];
        });
        docSection.blocks.unshift({ type: "table", caption: "Quality attribute coverage", columns: ["Category", "Coverage", "Reason if not applicable"], rows });
      }
      if (sectionConfig?.nfr) {
        const list = items.filter((item) => item.kind === "nonfunctional" && (JSON.parse(item.data || "{}") as { category?: string }).category === sectionConfig.nfr);
        if (nfrNa[sectionConfig.nfr]) docSection.blocks.push({ type: "notice", text: `Not applicable: ${nfrNa[sectionConfig.nfr]}` });
        else if (list.length) docSection.blocks.push({ type: "table", columns: ["ID", "Requirement", "Target"], rows: list.map((item) => [item.key, item.title, (JSON.parse(item.data || "{}") as { target?: string }).target ?? ""]) });
      }
      if (sectionConfig?.prefill === "signatures") {
        docSection.blocks.push({ type: "text", text: config.approval.statement, caption: "Approval statement" });
        docSection.blocks.push({ type: "notice", text: `This version requires ${config.approval.clientSigners} client and ${config.approval.companySigners} Elec Novatech approval${config.approval.companySigners + config.approval.clientSigners === 1 ? "" : "s"}. Approvals are recorded electronically with the signer's identity, time, IP address and a fingerprint of this exact version.` });
      }
      if (!docSection.blocks.length) docSection.blocks.push({ type: "notice", text: "To be completed." });
      out.push(docSection);
    }
    groups.push({ number, title: groupTitle, sections: out });
  }

  const contact = project.customer.contacts[0];
  const label = options.versionLabel ?? versionLabel(doc);
  const status = options.status ?? doc.status;
  return {
    meta: {
      code: doc.code,
      title: doc.title,
      version: label,
      status,
      statusLabel: SRS_STATUS_LABELS[status as SrsStatus] ?? status,
      projectName: project.name,
      projectCode: project.code,
      projectType: projectTypeLabel(doc.projectType),
      preparedBy: `Elec Novatech PLC${project.manager ? ` — ${project.manager.name}` : ""}`,
      preparedFor: `${project.customer.name}${contact ? ` — ${contact.name}` : ""}`,
      createdOn: date(doc.createdAt),
      updatedOn: date(new Date()),
      confidentiality: doc.confidentiality,
      template: `${doc.templateVersion.template.name} v${doc.templateVersion.version}`,
      accent: config.styling.accent,
      footer: config.styling.footer,
    },
    revisions: inputs.versions.map((v) => ({ version: v.label, date: date(v.approvedAt ?? v.createdAt), author: v.createdByName, status: v.status.replaceAll("_", " "), note: v.note })),
    approval: { clientSigners: config.approval.clientSigners, companySigners: config.approval.companySigners, statement: config.approval.statement, signatures: options.signatures ?? [] },
    groups,
  };
}

export function hashModel(model: DocModel) {
  const { meta, revisions, approval, ...content } = model;
  void revisions;
  return createHash("sha256").update(JSON.stringify({ meta: { ...meta, updatedOn: "", status: "", statusLabel: "" }, statement: approval.statement, content })).digest("hex");
}

export type Blocker = { code: string; message: string; tab: string };

export function completeness(inputs: Inputs) {
  const { doc, project, config, sections, answers, items } = inputs;
  const blockers: Blocker[] = [];
  const warnings: Blocker[] = [];
  const shared = sharedItems(items);
  const questions = allQuestions(config);
  const model = buildDocModel(inputs);
  const modelSections = model.groups.flatMap((g) => g.sections);
  for (const section of sections) {
    if (!section.required || !section.applicable) continue;
    const built = modelSections.find((s) => s.key === section.key);
    const empty = !built || built.blocks.every((b) => b.type === "notice");
    if (empty && config.sections.find((s) => s.key === section.key)?.prefill !== "signatures") blockers.push({ code: `section:${section.key}`, message: `Required section "${section.title}" is empty.`, tab: "document" });
  }
  for (const question of questions.filter((q) => q.required)) {
    if (!answers.find((a) => a.questionKey === question.key)?.value.trim()) blockers.push({ code: `question:${question.key}`, message: `Unanswered: ${question.label}`, tab: `wizard&step=${question.step}` });
  }
  for (const kind of config.requiredKinds) {
    if (!shared.some((item) => item.kind === kind)) blockers.push({ code: `kind:${kind}`, message: `Add at least one ${KINDS[kind]?.label.toLowerCase() ?? kind}.`, tab: KINDS[kind]?.tab ?? "requirements" });
  }
  for (const item of shared) {
    if (item.kind === "functional" && !item.criteria.length) blockers.push({ code: `criteria:${item.key}`, message: `${item.key} has no acceptance criteria.`, tab: "requirements" });
    if (item.status === "clarification_required" || item.origin === "needs_clarification") blockers.push({ code: `clarify:${item.key}`, message: `${item.key} still needs clarification.`, tab: KINDS[item.kind]?.tab ?? "requirements" });
    if (item.kind === "question" && !(JSON.parse(item.data || "{}") as { answer?: string }).answer) blockers.push({ code: `question-item:${item.key}`, message: `Open question ${item.key} is unanswered.`, tab: "scope" });
    if (item.reapprovalRequired) warnings.push({ code: `reapprove:${item.key}`, message: `${item.key} changed after approval and needs re-approval.`, tab: KINDS[item.kind]?.tab ?? "requirements" });
    if (item.kind === "functional" && item.status === "draft") warnings.push({ code: `draft:${item.key}`, message: `${item.key} has not been reviewed yet.`, tab: "requirements" });
  }
  const nfrNa = JSON.parse(doc.nfrNotApplicable || "{}") as Record<string, string>;
  for (const [key, label] of NFR_CATEGORIES) {
    const covered = shared.some((item) => item.kind === "nonfunctional" && (JSON.parse(item.data || "{}") as { category?: string }).category === key);
    if (!covered && !nfrNa[key]) blockers.push({ code: `nfr:${key}`, message: `${label}: add a requirement or mark it not applicable with a reason.`, tab: "nfr" });
  }
  if (!project.summary.trim() && !answers.find((a) => a.questionKey === "background")?.value.trim()) warnings.push({ code: "project:summary", message: "The project record has no summary to prefill the background.", tab: "document" });
  if (!project.dueOn) warnings.push({ code: "project:due", message: "The project has no target date.", tab: "overview" });
  if (!project.customer.contacts.length) warnings.push({ code: "customer:contact", message: "The customer has no contact to address the document to.", tab: "overview" });
  if (config.approval.clientSigners > 0 && !doc.clientAccess) warnings.push({ code: "client:access", message: "Client access is off, so the client cannot review or sign yet.", tab: "overview" });
  const requiredQuestions = questions.filter((q) => q.required);
  const answered = requiredQuestions.filter((q) => answers.find((a) => a.questionKey === q.key)?.value.trim()).length;
  const requiredSections = sections.filter((s) => s.required && s.applicable);
  const filledSections = requiredSections.filter((s) => {
    const built = modelSections.find((m) => m.key === s.key);
    return built && built.blocks.some((b) => b.type !== "notice");
  }).length;
  return { blockers, warnings, stats: { answered, questions: requiredQuestions.length, sections: requiredSections.length, filledSections, items: shared.length } };
}

export type DiffEntry = { area: string; key: string; title: string; change: "added" | "removed" | "changed"; before?: string; after?: string };

function flatten(model: DocModel) {
  const sections = new Map<string, { title: string; text: string }>();
  const items = new Map<string, { title: string; text: string }>();
  for (const group of model.groups) {
    for (const section of group.sections) {
      const text = section.notApplicable ? `Not applicable: ${section.notApplicable}` : section.blocks.filter((b) => b.type === "text" || b.type === "table").map((b) => (b.type === "text" ? b.text : b.rows.map((r) => r.join(" | ")).join("\n"))).join("\n\n");
      sections.set(section.key, { title: section.title, text });
      for (const block of section.blocks) {
        if (block.type !== "items") continue;
        for (const item of block.items) {
          const text = [item.title, item.description, `Priority: ${PRIORITY_LABELS[item.priority] ?? item.priority}`, ...item.fields.map(([k, v]) => `${k}: ${v}`), ...item.criteria.map((c) => `Given ${c.given} when ${c.when} then ${c.then}`), ...(item.steps ?? []).map((s) => `${s.id}. ${s.actor}: ${s.action}`)].join("\n");
          items.set(item.key, { title: item.title, text });
        }
      }
    }
  }
  return { sections, items };
}

export function diffModels(before: DocModel, after: DocModel): DiffEntry[] {
  const a = flatten(before);
  const b = flatten(after);
  const out: DiffEntry[] = [];
  for (const [area, left, right] of [["Section", a.sections, b.sections], ["Item", a.items, b.items]] as const) {
    for (const [key, value] of right) {
      const old = left.get(key);
      if (!old) out.push({ area, key, title: value.title, change: "added", after: value.text });
      else if (old.text !== value.text || old.title !== value.title) out.push({ area, key, title: value.title, change: "changed", before: old.text, after: value.text });
    }
    for (const [key, value] of left) if (!right.has(key)) out.push({ area, key, title: value.title, change: "removed", before: value.text });
  }
  return out;
}

export function qaLabel(status: string) {
  return QA_LABELS[status] ?? status;
}

export function itemsByKind(model: DocModel) {
  const map = new Map<string, DocItem[]>();
  for (const group of model.groups) for (const section of group.sections) for (const block of section.blocks) if (block.type === "items") map.set(block.kind, [...(map.get(block.kind) ?? []), ...block.items]);
  return map;
}

export function templateSummary(config: TemplateConfig) {
  return { sections: config.sections.length, required: config.sections.filter((s) => s.required).length, questions: allQuestions(config).length };
}
