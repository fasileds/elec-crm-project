export const SRS_STATUSES = [
  "draft",
  "client_input_required",
  "internal_review",
  "client_review",
  "changes_requested",
  "approval_pending",
  "approved",
  "superseded",
  "archived",
] as const;
export type SrsStatus = (typeof SRS_STATUSES)[number];

export const LOCKED_STATUSES: readonly string[] = ["approval_pending", "approved", "superseded", "archived"];

export const SRS_STATUS_LABELS: Record<SrsStatus, string> = {
  draft: "Draft",
  client_input_required: "Client input required",
  internal_review: "Internal review",
  client_review: "Client review",
  changes_requested: "Changes requested",
  approval_pending: "Approval pending",
  approved: "Approved",
  superseded: "Superseded",
  archived: "Archived",
};

export const ITEM_STATUSES = [
  "draft",
  "under_review",
  "clarification_required",
  "approved",
  "rejected",
  "implemented",
  "verified",
  "deferred",
  "deprecated",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_TRANSITIONS: Record<string, string[]> = {
  draft: ["under_review", "clarification_required", "deferred", "deprecated"],
  under_review: ["draft", "clarification_required", "approved", "rejected"],
  clarification_required: ["draft", "under_review"],
  approved: ["under_review", "implemented", "deferred", "deprecated"],
  rejected: ["draft", "deprecated"],
  implemented: ["verified", "approved"],
  verified: ["implemented", "deprecated"],
  deferred: ["draft", "under_review"],
  deprecated: [],
};

export const ORIGINS = ["client_input", "elec_proposal", "assumption", "needs_clarification"] as const;
export type Origin = (typeof ORIGINS)[number];
export const ORIGIN_LABELS: Record<Origin, string> = {
  client_input: "Client input",
  elec_proposal: "Elec Nova proposal",
  assumption: "Assumption",
  needs_clarification: "Needs clarification",
};

export const PRIORITIES = ["must", "should", "could", "wont"] as const;
export const PRIORITY_LABELS: Record<string, string> = { must: "Must have", should: "Should have", could: "Could have", wont: "Won't have (this release)" };

export const QA_STATUSES = ["pending", "passed", "failed", "blocked", "na"] as const;
export const QA_LABELS: Record<string, string> = { pending: "Pending", passed: "Passed", failed: "Failed", blocked: "Blocked", na: "N/A" };

export const NFR_CATEGORIES: Array<[string, string]> = [
  ["performance", "Performance"],
  ["scalability", "Scalability"],
  ["availability", "Availability"],
  ["reliability", "Reliability"],
  ["security", "Security"],
  ["privacy", "Privacy"],
  ["compliance", "Compliance"],
  ["usability", "Usability"],
  ["accessibility", "Accessibility"],
  ["compatibility", "Compatibility"],
  ["maintainability", "Maintainability"],
  ["observability", "Observability and logging"],
  ["backup_recovery", "Backup and recovery"],
  ["localization", "Localization"],
];

export type FieldType = "text" | "longtext" | "select" | "list" | "url";
export type KindField = { key: string; label: string; type: FieldType; options?: Array<[string, string]>; help?: string };
export type KindMeta = { label: string; plural: string; prefix: string; tab: string; fields: KindField[]; criteria?: boolean };

const yesNo: Array<[string, string]> = [["none", "No personal data"], ["personal", "Personal data"], ["sensitive", "Sensitive personal data"], ["regulated", "Regulated data"]];

export const KINDS: Record<string, KindMeta> = {
  functional: {
    label: "Functional requirement",
    plural: "Functional requirements",
    prefix: "FR",
    tab: "requirements",
    criteria: true,
    fields: [
      { key: "purpose", label: "Business purpose", type: "longtext" },
      { key: "stakeholder", label: "Requesting stakeholder", type: "text" },
      { key: "role", label: "User role", type: "text" },
      { key: "dependencies", label: "Dependencies", type: "text", help: "Other requirement IDs, e.g. FR-002" },
      { key: "related", label: "Related use cases / stories", type: "text", help: "IDs, e.g. UC-001, US-003" },
    ],
  },
  nonfunctional: {
    label: "Non-functional requirement",
    plural: "Non-functional requirements",
    prefix: "NFR",
    tab: "nfr",
    criteria: true,
    fields: [
      { key: "category", label: "Category", type: "select", options: NFR_CATEGORIES },
      { key: "metric", label: "Measure", type: "text", help: "How it is measured, e.g. p95 response time" },
      { key: "target", label: "Target", type: "text", help: "e.g. under 800 ms for 95% of requests" },
    ],
  },
  role: {
    label: "User role",
    plural: "User roles and actors",
    prefix: "ROLE",
    tab: "users",
    fields: [
      { key: "responsibilities", label: "Responsibilities", type: "longtext" },
      { key: "permissions", label: "Permissions", type: "longtext" },
      { key: "goals", label: "Goals", type: "longtext" },
      { key: "workflows", label: "Workflows", type: "text" },
    ],
  },
  use_case: {
    label: "Use case",
    plural: "Use cases",
    prefix: "UC",
    tab: "users",
    fields: [
      { key: "actor", label: "Actor", type: "text" },
      { key: "preconditions", label: "Preconditions", type: "longtext" },
      { key: "trigger", label: "Trigger", type: "text" },
      { key: "mainFlow", label: "Main flow", type: "list", help: "One step per line" },
      { key: "alternativeFlows", label: "Alternative flows", type: "list" },
      { key: "exceptionFlows", label: "Exception flows", type: "list" },
      { key: "postconditions", label: "Postconditions", type: "longtext" },
      { key: "rules", label: "Business rules", type: "text", help: "IDs, e.g. BR-001" },
      { key: "acceptance", label: "Acceptance criteria", type: "longtext" },
    ],
  },
  user_story: {
    label: "User story",
    plural: "User stories",
    prefix: "US",
    tab: "users",
    criteria: true,
    fields: [
      { key: "asA", label: "As a", type: "text" },
      { key: "iWant", label: "I want", type: "longtext" },
      { key: "soThat", label: "So that", type: "longtext" },
      { key: "related", label: "Related requirements", type: "text" },
    ],
  },
  business_rule: {
    label: "Business rule",
    plural: "Business rules",
    prefix: "BR",
    tab: "rules",
    fields: [
      { key: "rule", label: "Rule", type: "longtext" },
      { key: "rationale", label: "Rationale", type: "longtext" },
      { key: "appliesTo", label: "Applies to", type: "text", help: "Requirement or workflow IDs" },
    ],
  },
  workflow: {
    label: "Workflow",
    plural: "Workflows",
    prefix: "WF",
    tab: "rules",
    fields: [{ key: "trigger", label: "Starts when", type: "text" }, { key: "outcome", label: "Ends when", type: "text" }],
  },
  screen: {
    label: "Screen",
    plural: "UI/UX screens",
    prefix: "UI",
    tab: "data",
    fields: [
      { key: "purpose", label: "Purpose", type: "longtext" },
      { key: "users", label: "Used by", type: "text" },
      { key: "link", label: "Reference link", type: "url" },
      { key: "figma", label: "Figma link", type: "url" },
      { key: "notes", label: "Design notes", type: "longtext" },
    ],
  },
  entity: {
    label: "Data entity",
    plural: "Data dictionary",
    prefix: "DE",
    tab: "data",
    fields: [
      { key: "fields", label: "Fields", type: "list", help: "One per line: name | type | required | validation" },
      { key: "owner", label: "Data owner", type: "text" },
      { key: "retention", label: "Retention", type: "text" },
      { key: "privacy", label: "Privacy classification", type: "select", options: yesNo },
    ],
  },
  integration: {
    label: "Integration",
    plural: "Integrations",
    prefix: "INT",
    tab: "data",
    fields: [
      { key: "system", label: "External system", type: "text" },
      { key: "direction", label: "Direction", type: "select", options: [["inbound", "Inbound"], ["outbound", "Outbound"], ["both", "Both ways"]] },
      { key: "method", label: "Method", type: "text", help: "e.g. REST API, webhook, SFTP" },
      { key: "data", label: "Data exchanged", type: "longtext" },
      { key: "authentication", label: "Authentication approach", type: "text", help: "Describe the approach only. Never enter keys, tokens, or passwords." },
      { key: "frequency", label: "Frequency", type: "text" },
      { key: "owner", label: "Owner", type: "text" },
    ],
  },
  scope_in: { label: "In-scope item", plural: "In scope", prefix: "SC-IN", tab: "scope", fields: [] },
  scope_out: { label: "Out-of-scope item", plural: "Out of scope", prefix: "SC-OUT", tab: "scope", fields: [] },
  scope_future: { label: "Future phase item", plural: "Future phase", prefix: "SC-FUT", tab: "scope", fields: [] },
  assumption: { label: "Assumption", plural: "Assumptions", prefix: "AS", tab: "scope", fields: [{ key: "impact", label: "Impact if wrong", type: "longtext" }] },
  constraint: { label: "Constraint", plural: "Constraints", prefix: "CON", tab: "scope", fields: [] },
  dependency: { label: "Dependency", plural: "Dependencies", prefix: "DEP", tab: "scope", fields: [{ key: "owner", label: "Owner", type: "text" }] },
  deliverable: {
    label: "Deliverable",
    plural: "Deliverables",
    prefix: "DLV",
    tab: "scope",
    fields: [{ key: "dueOn", label: "Target date", type: "text" }, { key: "acceptance", label: "Accepted when", type: "longtext" }],
  },
  risk: {
    label: "Risk",
    plural: "Risks",
    prefix: "RSK",
    tab: "scope",
    fields: [
      { key: "likelihood", label: "Likelihood", type: "select", options: [["low", "Low"], ["medium", "Medium"], ["high", "High"]] },
      { key: "impact", label: "Impact", type: "select", options: [["low", "Low"], ["medium", "Medium"], ["high", "High"]] },
      { key: "mitigation", label: "Mitigation", type: "longtext" },
    ],
  },
  question: {
    label: "Open question",
    plural: "Open questions",
    prefix: "Q",
    tab: "scope",
    fields: [{ key: "askedOf", label: "Asked of", type: "text" }, { key: "answer", label: "Answer", type: "longtext" }],
  },
  definition: { label: "Definition", plural: "Definitions and acronyms", prefix: "DEF", tab: "scope", fields: [] },
  stakeholder: {
    label: "Stakeholder",
    plural: "Stakeholders",
    prefix: "STK",
    tab: "users",
    fields: [
      { key: "organization", label: "Organization", type: "text" },
      { key: "role", label: "Role", type: "text" },
      { key: "responsibility", label: "Responsibility", type: "longtext" },
    ],
  },
};

export type SectionConfig = {
  key: string;
  title: string;
  group: string;
  required: boolean;
  guidance?: string;
  kinds?: string[];
  nfr?: string;
  prefill?: "summary" | "objectives" | "scope" | "opportunity" | "milestones" | "team" | "change_management" | "signatures" | "testing";
};

export type QuestionConfig = {
  key: string;
  label: string;
  help?: string;
  type: "text" | "longtext" | "list" | "choice";
  options?: string[];
  required: boolean;
  section: string;
  generates?: string;
};

export type StepConfig = { key: string; title: string; intro: string; questions: QuestionConfig[] };

export type TemplateConfig = {
  sections: SectionConfig[];
  steps: StepConfig[];
  requiredKinds: string[];
  approval: { clientSigners: number; companySigners: number; statement: string };
  styling: { accent: string; footer: string; confidentiality: string };
};

const S = (key: string, title: string, group: string, required: boolean, extra: Partial<SectionConfig> = {}): SectionConfig => ({ key, title, group, required, ...extra });

export const MASTER_SECTIONS: SectionConfig[] = [
  S("purpose", "Purpose", "Introduction", true, { guidance: "Why this document exists and who it is for." }),
  S("scope", "Scope", "Introduction", true, { kinds: ["scope_in"], prefill: "scope" }),
  S("background", "Background", "Introduction", true, { prefill: "summary" }),
  S("business_context", "Business context", "Introduction", false, { prefill: "opportunity" }),
  S("objectives", "Business objectives", "Introduction", true, { prefill: "objectives" }),
  S("goals", "Goals and success metrics", "Introduction", true),
  S("stakeholders", "Stakeholders and responsibilities", "Introduction", true, { kinds: ["stakeholder"], prefill: "team" }),
  S("definitions", "Definitions and acronyms", "Introduction", false, { kinds: ["definition"] }),
  S("references", "References", "Introduction", false),
  S("assumptions", "Assumptions", "Context", true, { kinds: ["assumption"] }),
  S("constraints", "Constraints", "Context", false, { kinds: ["constraint"] }),
  S("dependencies", "Dependencies", "Context", false, { kinds: ["dependency"] }),
  S("out_of_scope", "Out of scope and future phases", "Context", true, { kinds: ["scope_out", "scope_future"] }),
  S("current_system", "Current system", "Context", false),
  S("proposed_solution", "Proposed solution", "Context", true),
  S("user_roles", "User roles and actors", "Users and behaviour", true, { kinds: ["role"] }),
  S("functional", "Functional requirements", "Users and behaviour", true, { kinds: ["functional"] }),
  S("use_cases", "Use cases and user stories", "Users and behaviour", false, { kinds: ["use_case", "user_story"] }),
  S("business_rules", "Business rules", "Users and behaviour", false, { kinds: ["business_rule"] }),
  S("workflows", "Workflows", "Users and behaviour", false, { kinds: ["workflow"] }),
  S("data", "Data requirements", "Data and integrations", false, { kinds: ["entity"] }),
  S("integrations", "Integrations", "Data and integrations", false, { kinds: ["integration"] }),
  S("ui_ux", "UI/UX requirements", "Data and integrations", false, { kinds: ["screen"] }),
  S("nonfunctional", "Non-functional requirements", "Quality attributes", true, { kinds: ["nonfunctional"] }),
  S("security", "Security requirements", "Quality attributes", true, { nfr: "security" }),
  S("performance", "Performance requirements", "Quality attributes", false, { nfr: "performance" }),
  S("availability", "Availability and reliability", "Quality attributes", false, { nfr: "availability" }),
  S("compatibility", "Compatibility", "Quality attributes", false, { nfr: "compatibility" }),
  S("accessibility", "Accessibility", "Quality attributes", false, { nfr: "accessibility" }),
  S("reporting", "Reporting", "Operations", false),
  S("notifications", "Notifications", "Operations", false),
  S("audit_logging", "Audit and logging", "Operations", false),
  S("infrastructure", "Infrastructure and hosting", "Operations", false),
  S("testing", "Testing and acceptance", "Delivery", true, { prefill: "testing" }),
  S("deliverables", "Deliverables", "Delivery", true, { kinds: ["deliverable"] }),
  S("milestones", "Milestones", "Delivery", false, { prefill: "milestones" }),
  S("responsibilities", "Project responsibilities", "Delivery", false),
  S("risks", "Risks", "Delivery", false, { kinds: ["risk"] }),
  S("open_questions", "Open questions", "Delivery", false, { kinds: ["question"] }),
  S("approval_criteria", "Approval criteria", "Governance", true),
  S("change_management", "Change management", "Governance", true, { prefill: "change_management" }),
  S("sign_off", "Sign-off", "Governance", true, { prefill: "signatures" }),
];

const Q = (key: string, label: string, section: string, type: QuestionConfig["type"], required = false, extra: Partial<QuestionConfig> = {}): QuestionConfig => ({ key, label, section, type, required, ...extra });

export const MASTER_STEPS: StepConfig[] = [
  { key: "overview", title: "Overview", intro: "Tell us about the project in your own words.", questions: [
    Q("purpose", "What should this project achieve for your business?", "purpose", "longtext", true),
    Q("background", "What led to this project? Anything we should know about your situation?", "background", "longtext", true),
    Q("business_context", "Who are your customers, and how does this project fit your business?", "business_context", "longtext"),
  ] },
  { key: "goals", title: "Goals", intro: "What does success look like?", questions: [
    Q("objectives", "List your main business objectives.", "objectives", "list", true, { help: "One objective per line." }),
    Q("success_metrics", "How will you measure success after launch?", "goals", "longtext", true, { help: "For example: reduce order handling time by 30%." }),
  ] },
  { key: "users", title: "Users", intro: "Who will use the system?", questions: [
    Q("user_groups", "Which groups of people will use the system?", "user_roles", "list", true, { generates: "role", help: "One group per line, e.g. 'Store manager: approves refunds'." }),
    Q("stakeholders", "Who else is involved or affected (approvers, departments, partners)?", "stakeholders", "list", false, { generates: "stakeholder" }),
  ] },
  { key: "problems", title: "Problems", intro: "What is not working today?", questions: [
    Q("current_process", "How is this work done today? Which tools are used?", "current_system", "longtext"),
    Q("pain_points", "What are the biggest problems with the current way of working?", "business_context", "list"),
  ] },
  { key: "solution", title: "Solution", intro: "Your picture of the new system.", questions: [
    Q("proposed_solution", "Describe the solution you have in mind.", "proposed_solution", "longtext", true),
    Q("platforms", "Where should it run (web, phone, tablet, desktop)?", "proposed_solution", "text"),
  ] },
  { key: "features", title: "Features", intro: "What should the system do?", questions: [
    Q("features", "List the things the system must let people do.", "functional", "list", true, { generates: "functional", help: "One feature per line. Start with the most important. 'Title: details' works well." }),
    Q("priorities", "Which features are essential for the first release?", "functional", "longtext"),
  ] },
  { key: "workflows", title: "Workflows", intro: "How work moves through the system.", questions: [
    Q("key_processes", "Which processes should the system support from start to finish?", "workflows", "list", false, { generates: "workflow" }),
    Q("business_rules", "Are there rules the system must always enforce?", "business_rules", "list", false, { generates: "business_rule", help: "e.g. 'Refunds over $500 need manager approval'." }),
  ] },
  { key: "data", title: "Data", intro: "Information the system keeps.", questions: [
    Q("data_entities", "What information will the system store?", "data", "list", false, { generates: "entity", help: "One type of record per line, e.g. 'Customer', 'Order'." }),
    Q("data_sensitivity", "Does it include personal or sensitive data?", "data", "choice", true, { options: ["No personal data", "Personal data", "Sensitive personal data", "Regulated data (health, payment, etc.)"] }),
    Q("retention", "How long must information be kept?", "data", "text"),
  ] },
  { key: "integrations", title: "Integrations", intro: "Other systems to connect with.", questions: [
    Q("integrations", "Which existing systems must it connect to?", "integrations", "list", false, { generates: "integration", help: "Name the system and what is exchanged. Never paste passwords or API keys." }),
  ] },
  { key: "ui_ux", title: "UI/UX", intro: "Look, feel and screens.", questions: [
    Q("brand", "Do you have brand guidelines or design preferences?", "ui_ux", "longtext"),
    Q("screens", "Which main screens do you expect?", "ui_ux", "list", false, { generates: "screen" }),
    Q("design_links", "Links to designs, mock-ups or examples you like.", "ui_ux", "longtext"),
  ] },
  { key: "security", title: "Security", intro: "Protecting the system and its data.", questions: [
    Q("access_control", "Who should be able to see or change what?", "security", "longtext", true),
    Q("compliance", "Are there laws, standards or policies to follow?", "security", "longtext"),
  ] },
  { key: "reports", title: "Reports", intro: "Information you need out of the system.", questions: [
    Q("reports", "Which reports or dashboards do you need?", "reporting", "list"),
  ] },
  { key: "notifications", title: "Notifications", intro: "Messages the system sends.", questions: [
    Q("notifications", "When should people be notified, and how (email, SMS, in-app)?", "notifications", "list"),
  ] },
  { key: "nfr", title: "Quality", intro: "Speed, reliability and reach.", questions: [
    Q("performance", "How many people will use it at once? How fast must it feel?", "performance", "longtext"),
    Q("availability", "When must it be available? What happens if it is down?", "availability", "longtext"),
    Q("compatibility", "Which browsers, devices or operating systems must be supported?", "compatibility", "text"),
    Q("accessibility", "Any accessibility needs (e.g. screen readers, WCAG level)?", "accessibility", "text"),
  ] },
  { key: "scope", title: "Scope", intro: "Draw the boundary of this project.", questions: [
    Q("in_scope", "What is definitely included?", "scope", "list", true, { generates: "scope_in" }),
    Q("out_of_scope", "What is definitely not included?", "out_of_scope", "list", true, { generates: "scope_out" }),
    Q("future", "What could come in a later phase?", "out_of_scope", "list", false, { generates: "scope_future" }),
  ] },
  { key: "assumptions", title: "Assumptions", intro: "Things we are taking for granted.", questions: [
    Q("assumptions", "What are we assuming to be true?", "assumptions", "list", false, { generates: "assumption" }),
  ] },
  { key: "constraints", title: "Constraints", intro: "Limits we must work within.", questions: [
    Q("constraints", "Any fixed limits (budget, technology, regulation)?", "constraints", "list", false, { generates: "constraint" }),
    Q("dependencies", "What do we depend on from you or third parties?", "dependencies", "list", false, { generates: "dependency" }),
    Q("timeline", "Are there important dates or deadlines?", "constraints", "text"),
  ] },
  { key: "deliverables", title: "Deliverables", intro: "What you will receive.", questions: [
    Q("deliverables", "What do you expect to receive at the end?", "deliverables", "list", true, { generates: "deliverable" }),
  ] },
  { key: "acceptance", title: "Acceptance", intro: "How you will decide the work is done.", questions: [
    Q("acceptance_approach", "How will you test and accept the system?", "testing", "longtext", true),
    Q("approval_criteria", "What must be true before you approve this specification?", "approval_criteria", "longtext"),
  ] },
  { key: "questions", title: "Questions", intro: "Anything still open.", questions: [
    Q("open_questions", "Questions you have for us, or decisions still to be made.", "open_questions", "list", false, { generates: "question" }),
  ] },
  { key: "review", title: "Review", intro: "Check what is still missing before review.", questions: [] },
  { key: "approval", title: "Approval", intro: "Submit for review and approval.", questions: [] },
];

export const PROJECT_TYPES: Array<[string, string]> = [
  ["web_app", "Web application"],
  ["mobile", "Mobile application"],
  ["saas", "SaaS platform"],
  ["erp", "ERP / business system"],
  ["ecommerce", "E-commerce"],
  ["api_backend", "API / backend service"],
  ["ai", "AI solution"],
  ["automation", "Automation"],
  ["internal", "Internal business system"],
  ["custom", "Custom project"],
];

type Overlay = { questions?: Array<[string, QuestionConfig]>; required?: string[]; requiredKinds?: string[] };

const TYPE_OVERLAYS: Record<string, Overlay> = {
  web_app: { questions: [["nfr", Q("browsers", "Which browsers and screen sizes matter most?", "compatibility", "text", true)]], required: ["compatibility"] },
  mobile: {
    questions: [
      ["solution", Q("mobile_platforms", "iOS, Android, or both? Will it be published in the app stores?", "proposed_solution", "text", true)],
      ["nfr", Q("offline", "Must the app work without an internet connection?", "availability", "longtext")],
      ["notifications", Q("push", "Which push notifications are needed?", "notifications", "list")],
    ],
    required: ["compatibility", "notifications"],
  },
  saas: {
    questions: [
      ["solution", Q("tenancy", "Will each customer organization have its own separate workspace?", "proposed_solution", "longtext", true)],
      ["integrations", Q("billing", "How will subscribers be billed?", "integrations", "longtext")],
    ],
    required: ["availability", "infrastructure"],
  },
  erp: {
    questions: [
      ["features", Q("modules", "Which business areas are included (finance, inventory, HR, sales)?", "functional", "list", true)],
      ["data", Q("migration", "What existing data must be migrated, and from where?", "data", "longtext", true)],
    ],
    required: ["data", "user_roles", "reporting"],
  },
  ecommerce: {
    questions: [
      ["features", Q("catalog", "What do you sell, and how is the catalog organized?", "functional", "longtext", true)],
      ["integrations", Q("payments", "Which payment methods and providers are required?", "integrations", "text", true)],
      ["workflows", Q("fulfilment", "How are orders shipped, returned and refunded?", "workflows", "longtext")],
    ],
    required: ["integrations", "security", "performance"],
  },
  api_backend: {
    questions: [
      ["users", Q("consumers", "Which applications or partners will call the API?", "user_roles", "list", true)],
      ["nfr", Q("api_limits", "Expected request volumes, rate limits and versioning approach.", "performance", "longtext", true)],
    ],
    required: ["integrations", "performance", "security"],
  },
  ai: {
    questions: [
      ["data", Q("ai_data", "Which data sources will the AI use? Who owns them?", "data", "longtext", true)],
      ["features", Q("ai_behaviour", "What should the AI decide or produce? Where must a person review it?", "functional", "longtext", true)],
      ["acceptance", Q("ai_evaluation", "How will we judge whether the AI is accurate enough?", "testing", "longtext", true)],
    ],
    required: ["data", "risks"],
    requiredKinds: ["risk"],
  },
  automation: {
    questions: [
      ["workflows", Q("triggers", "Which events should start the automation?", "workflows", "list", true)],
      ["workflows", Q("failure_handling", "What should happen when an automated step fails?", "workflows", "longtext", true)],
    ],
    required: ["workflows", "integrations"],
    requiredKinds: ["workflow"],
  },
  internal: {
    questions: [
      ["users", Q("departments", "Which departments will use the system?", "user_roles", "list", true)],
      ["deliverables", Q("training", "What training or rollout support is needed?", "deliverables", "longtext")],
    ],
    required: ["user_roles", "reporting"],
  },
  custom: {},
};

export function defaultTemplateConfig(projectType = "custom"): TemplateConfig {
  const overlay = TYPE_OVERLAYS[projectType] ?? {};
  const required = new Set(overlay.required ?? []);
  const steps = MASTER_STEPS.map((step) => ({
    ...step,
    questions: [...step.questions, ...(overlay.questions ?? []).filter(([stepKey]) => stepKey === step.key).map(([, question]) => question)],
  }));
  return {
    sections: MASTER_SECTIONS.map((section) => ({ ...section, required: section.required || required.has(section.key) })),
    steps,
    requiredKinds: ["functional", "nonfunctional", "role", "scope_in", "scope_out", "deliverable", ...(overlay.requiredKinds ?? [])],
    approval: {
      clientSigners: 1,
      companySigners: 1,
      statement: "I have reviewed this Software Requirements Specification and approve it as the agreed baseline for delivery. Changes after approval follow the change management process.",
    },
    styling: { accent: "#0b5cab", footer: "Elec Novatech PLC · AI solutions for smarter businesses", confidentiality: "Confidential" },
  };
}

export function projectTypeLabel(type: string) {
  return PROJECT_TYPES.find(([key]) => key === type)?.[1] ?? "Custom project";
}

export function stepOf(config: TemplateConfig, key: string) {
  return config.steps.find((step) => step.key === key);
}

export function allQuestions(config: TemplateConfig) {
  return config.steps.flatMap((step) => step.questions.map((question) => ({ ...question, step: step.key })));
}
