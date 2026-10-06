export const PROJECT_TRANSITIONS: Record<string, string[]> = {
  draft: ["proposed", "cancelled", "archived"],
  proposed: ["draft", "approved", "cancelled", "archived"],
  approved: ["onboarding", "planning", "cancelled", "archived"],
  onboarding: ["planning", "approved", "cancelled", "archived"],
  planning: ["active", "onboarding", "on_hold", "cancelled", "archived"],
  active: ["on_hold", "blocked", "completed", "cancelled"],
  on_hold: ["active", "planning", "cancelled", "archived"],
  blocked: ["active", "on_hold", "cancelled"],
  completed: ["delivered", "active"],
  delivered: ["archived", "active"],
  cancelled: ["archived", "draft"],
  archived: ["draft", "active", "completed", "delivered", "cancelled"],
};

export const CHANGE_TRANSITIONS: Record<string, string[]> = {
  requested: ["under_review", "rejected", "closed"],
  under_review: ["approved", "rejected", "requested"],
  approved: ["scheduled", "rejected"],
  rejected: ["requested", "closed"],
  scheduled: ["implemented", "approved"],
  implemented: ["verified", "scheduled"],
  verified: ["closed", "implemented"],
  closed: [],
};

export const REQUIREMENT_TRANSITIONS: Record<string, string[]> = {
  draft: ["proposed", "deferred"],
  proposed: ["approved", "rejected", "draft"],
  approved: ["implemented", "proposed"],
  rejected: ["draft", "proposed"],
  implemented: ["verified", "approved"],
  verified: ["implemented"],
  deferred: ["draft"],
};

export const TASK_TRANSITIONS: Record<string, string[]> = {
  backlog: ["ready", "cancelled"],
  ready: ["in_progress", "blocked", "cancelled", "backlog"],
  in_progress: ["in_review", "blocked", "done", "cancelled"],
  blocked: ["ready", "in_progress", "cancelled"],
  in_review: ["done", "in_progress"],
  done: ["in_progress"],
  cancelled: ["backlog"],
};

export const LEAD_TRANSITIONS: Record<string, string[]> = {
  new: ["contacted", "working", "nurturing", "unqualified", "lost", "archived"],
  contacted: ["working", "qualified", "nurturing", "unqualified", "lost", "archived", "new"],
  working: ["contacted", "qualified", "nurturing", "unqualified", "lost"],
  qualified: ["working", "nurturing", "lost", "contacted", "unqualified", "archived"],
  unqualified: ["contacted", "nurturing", "archived"],
  nurturing: ["contacted", "working", "qualified", "dormant", "lost"],
  dormant: ["nurturing", "contacted", "lost", "archived"],
  lost: ["nurturing", "archived"],
  converted: [],
  archived: ["new"],
};

export const OPPORTUNITY_TRANSITIONS: Record<string, string[]> = {
  qualification: ["discovery", "lost"],
  discovery: ["requirements", "qualification", "lost"],
  requirements: ["proposal", "discovery", "lost"],
  proposal: ["negotiation", "requirements", "lost"],
  negotiation: ["verbal", "proposal", "lost"],
  verbal: ["won", "negotiation", "lost"],
  won: [],
  lost: ["qualification"],
};

export const STAGE_PROBABILITY: Record<string, number> = {
  qualification: 10,
  discovery: 20,
  requirements: 40,
  proposal: 60,
  negotiation: 75,
  verbal: 90,
  won: 100,
  lost: 0,
};

export const DEFAULT_PHASES = [
  ["discovery", "Discovery"],
  ["requirements", "Requirements"],
  ["design", "Design"],
  ["development", "Development"],
  ["qa", "QA and testing"],
  ["client_review", "Client review"],
  ["revisions", "Revisions"],
  ["deployment", "Deployment"],
  ["handover", "Handover"],
  ["maintenance", "Maintenance"],
] as const;

export const ONBOARDING_STEPS = [
  ["verify_customer", "Verify customer information", true],
  ["assign_contacts", "Assign customer contacts", true],
  ["gather_requirements", "Gather requirements", true],
  ["approve_scope", "Approve scope", true],
  ["assign_team", "Assign the delivery team", true],
  ["plan_milestones", "Plan initial milestones", true],
  ["communication_setup", "Set up customer communication", false],
  ["kickoff", "Hold the project kickoff", true],
] as const;

export const OPEN_TASK = new Set(["backlog", "ready", "in_progress", "blocked", "in_review"]);
export const OPEN_CHANGE = new Set(["requested", "under_review", "approved", "scheduled", "implemented"]);

export function canTransition(map: Record<string, string[]>, from: string, to: string) {
  return map[from]?.includes(to) ?? false;
}
