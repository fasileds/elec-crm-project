export const DASHBOARD_WIDGETS = [
  "attention",
  "metrics",
  "mine",
  "health",
  "pipeline",
  "deadlines",
  "workload",
  "commercial",
  "activity",
] as const;

export type DashboardWidget = (typeof DASHBOARD_WIDGETS)[number];

const WIDGET_SET = new Set<string>(DASHBOARD_WIDGETS);

export function lensFor(permissions: readonly string[]) {
  if (permissions.includes("settings.manage") || permissions.includes("employees.manage")) {
    return { id: "administrator", label: "Administrator" };
  }
  if (permissions.includes("finance.view") && !permissions.includes("tasks.edit")) {
    return { id: "finance", label: "Finance" };
  }
  if (permissions.includes("leads.view") && !permissions.includes("tasks.assign")) {
    return { id: "sales", label: "Account" };
  }
  if (permissions.includes("approvals.decide") || permissions.includes("projects.transition") || permissions.includes("reports.view")) {
    return { id: "delivery", label: "Delivery" };
  }
  return { id: "contributor", label: "My work" };
}

export function widgetAllowed(widget: DashboardWidget, permissions: readonly string[]) {
  if (widget === "pipeline") return permissions.includes("leads.view");
  if (widget === "workload") return permissions.includes("employees.view") || permissions.includes("reports.view");
  if (widget === "commercial") return permissions.includes("finance.view");
  if (widget === "health" || widget === "metrics") return permissions.includes("projects.view") || permissions.includes("tasks.view");
  return true;
}

export function widgetsFor(permissions: readonly string[]): DashboardWidget[] {
  const lens = lensFor(permissions).id;
  const preferred: Record<string, DashboardWidget[]> = {
    administrator: ["attention", "metrics", "health", "commercial", "workload", "pipeline", "deadlines", "activity", "mine"],
    finance: ["attention", "metrics", "commercial", "health", "deadlines", "activity"],
    sales: ["attention", "metrics", "pipeline", "health", "deadlines", "activity", "mine"],
    delivery: ["attention", "metrics", "health", "mine", "deadlines", "workload", "activity", "pipeline"],
    contributor: ["attention", "mine", "deadlines", "health", "activity"],
  };
  return (preferred[lens] ?? preferred.contributor)!.filter((widget) => widgetAllowed(widget, permissions));
}

export function arrangeWidgets(saved: readonly string[] | null, available: readonly DashboardWidget[]): DashboardWidget[] {
  const allow = new Set(available);
  const ordered: DashboardWidget[] = [];
  for (const id of saved ?? []) {
    if (WIDGET_SET.has(id) && allow.has(id as DashboardWidget) && !ordered.includes(id as DashboardWidget)) {
      ordered.push(id as DashboardWidget);
    }
  }
  for (const id of available) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

export function moveWidget(order: readonly string[], id: string, direction: "up" | "down"): DashboardWidget[] {
  const current = order.filter((item): item is DashboardWidget => WIDGET_SET.has(item));
  const index = current.indexOf(id as DashboardWidget);
  if (index < 0) return current;
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= current.length) return current;
  const copy = [...current];
  const [item] = copy.splice(index, 1);
  copy.splice(nextIndex, 0, item!);
  return copy;
}
