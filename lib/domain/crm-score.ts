export type ScoreInput = {
  source: string | null;
  industry: string | null;
  email: string | null;
  phone: string | null;
  company: string;
  estimatedValueCents: number | null;
  priority: string;
  activityCount: number;
};

export type ScoreRule = { key: string; label: string; points: number; enabled: boolean; kind: string; match: string };

export function explainScore(input: ScoreInput, rules: ScoreRule[]) {
  const reasons: string[] = [];
  let score = 0;
  for (const rule of rules) {
    if (!rule.enabled || !matches(rule, input)) continue;
    score += rule.points;
    reasons.push(`${rule.label} (+${rule.points})`);
  }
  score = Math.max(0, Math.min(100, score));
  if (reasons.length === 0) reasons.push("No enabled scoring rule matched this lead");
  return { score, reasons };
}

function matches(rule: ScoreRule, input: ScoreInput) {
  if (rule.kind === "attribute" && rule.match === "email") return Boolean(input.email);
  if (rule.kind === "attribute" && rule.match === "phone") return Boolean(input.phone);
  if (rule.kind === "attribute" && rule.match === "company") return input.company.trim().length > 1;
  if (rule.kind === "attribute" && rule.match === "value") return (input.estimatedValueCents ?? 0) > 0;
  if (rule.kind === "source") return input.source === rule.match;
  if (rule.kind === "industry") return input.industry === rule.match;
  if (rule.kind === "priority") return input.priority === "high" || input.priority === "critical";
  if (rule.kind === "engagement") return input.activityCount >= Number(rule.match || 1);
  return false;
}
