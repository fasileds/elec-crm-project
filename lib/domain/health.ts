export type HealthStatus = "healthy" | "watch" | "at_risk" | "critical";

export type HealthInput = {
  overdueMilestones: number;
  overdueCriticalTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  openBlockers: number;
  dueWithinThreeDays: number;
  openChangeRequests: number;
  scopeChangesAfterBaseline: number;
  managerInactive: boolean;
};

export function scoreProjectHealth(input: HealthInput) {
  const reasons: string[] = [];
  let score = 100;

  if (input.overdueMilestones > 0) {
    score -= input.overdueMilestones * 15;
    reasons.push(`${input.overdueMilestones} overdue milestone${input.overdueMilestones === 1 ? "" : "s"}`);
  }
  if (input.overdueCriticalTasks > 0) {
    score -= input.overdueCriticalTasks * 12;
    reasons.push(`${input.overdueCriticalTasks} overdue critical task${input.overdueCriticalTasks === 1 ? "" : "s"}`);
  }
  if (input.overdueTasks > 0) {
    score -= input.overdueTasks * 6;
    reasons.push(`${input.overdueTasks} overdue task${input.overdueTasks === 1 ? "" : "s"}`);
  }
  if (input.blockedTasks > 0) {
    score -= input.blockedTasks * 8;
    reasons.push(`${input.blockedTasks} blocked task${input.blockedTasks === 1 ? "" : "s"}`);
  }
  if (input.openBlockers > 0) {
    score -= input.openBlockers * 10;
    reasons.push(`${input.openBlockers} unresolved blocker${input.openBlockers === 1 ? "" : "s"}`);
  }
  if (input.dueWithinThreeDays > 0) {
    score -= 8;
    reasons.push("A deadline is within three days");
  }
  if (input.openChangeRequests > 0) {
    score -= input.openChangeRequests * 4;
    reasons.push(`${input.openChangeRequests} open change request${input.openChangeRequests === 1 ? "" : "s"}`);
  }
  if (input.scopeChangesAfterBaseline > 0) {
    score -= input.scopeChangesAfterBaseline * 5;
    reasons.push(`${input.scopeChangesAfterBaseline} scope change${input.scopeChangesAfterBaseline === 1 ? "" : "s"} after baseline`);
  }
  if (input.managerInactive) {
    score -= 10;
    reasons.push("The project manager is inactive");
  }

  score = Math.max(0, Math.min(100, score));
  const status: HealthStatus = score >= 80 ? "healthy" : score >= 60 ? "watch" : score >= 40 ? "at_risk" : "critical";
  if (reasons.length === 0) reasons.push("No overdue work, blockers, or scope pressure");
  return { score, status, reasons };
}
