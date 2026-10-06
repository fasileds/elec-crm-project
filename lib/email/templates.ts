export type RenderedEmail = { subject: string; text: string; html: string };

function layout(title: string, body: string) {
  const text = `${title}\n\n${body}\n\nElec Novatech PLC`;
  const base = process.env.APP_URL?.replace(/\/$/, "") ?? "";
  const logo = base ? `<img src="${escapeHtml(base)}/brand/logo.jpg" alt="Elec Novatech PLC" width="180" style="display:block;width:180px;height:auto;margin:0 0 16px;background:#ffffff" />` : `<p style="font-weight:700;letter-spacing:.04em">ELEC NOVATECH PLC</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#16181d;line-height:1.5"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px"><tr><td align="center"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e3e5ea;border-radius:12px;padding:24px"><tr><td>${logo}<h1 style="font-size:20px;margin:0 0 12px;color:#16181d">${escapeHtml(title)}</h1><p style="margin:0;color:#3e4654">${escapeHtml(body).replaceAll("\n", "<br>")}</p><p style="margin:20px 0 0;font-size:12px;color:#4e5666">Elec Novatech PLC · AI solutions for smarter businesses</p></td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

const TEMPLATES: Record<string, (payload: Record<string, string>) => RenderedEmail> = {
  invitation: (payload) => ({
    subject: `You're invited to ${payload.organization}`,
    ...layout(`Join ${payload.organization}`, `${payload.inviter} invited you to Elec as ${payload.role}.\n\nAccept the invitation: ${payload.url}\n\nThis link expires in 7 days.`),
  }),
  verify_email: (payload) => ({
    subject: "Verify your email",
    ...layout("Verify your email", `Confirm ${payload.email} for ${payload.organization}.\n\n${payload.url}\n\nThis link expires in 24 hours.`),
  }),
  password_reset: (payload) => ({
    subject: "Reset your password",
    ...layout("Reset your password", `A password reset was requested for ${payload.email}.\n\n${payload.url}\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`),
  }),
  customer_onboarding: (payload) => ({
    subject: `Welcome to ${payload.organization}`,
    ...layout("Your workspace is ready", `${payload.organization} opened a workspace for ${payload.customer}.\n\nSign in: ${payload.url}`),
  }),
  project_created: (payload) => ({
    subject: `Project opened: ${payload.project}`,
    ...layout("A project was opened", `${payload.actor} opened ${payload.project} for ${payload.customer}.\n\n${payload.url}`),
  }),
  project_status: (payload) => ({
    subject: `${payload.project} is now ${payload.status}`,
    ...layout("Project status changed", `${payload.project} moved from ${payload.from} to ${payload.status}.\n\n${payload.url}`),
  }),
  task_assigned: (payload) => ({
    subject: `Assigned: ${payload.task}`,
    ...layout("You have new work", `${payload.actor} assigned you ${payload.task} on ${payload.project}. Due ${payload.due}.\n\n${payload.url}`),
  }),
  task_due: (payload) => ({
    subject: `Due soon: ${payload.task}`,
    ...layout("A task is due soon", `${payload.task} on ${payload.project} is due ${payload.due}.\n\n${payload.url}`),
  }),
  task_overdue: (payload) => ({
    subject: `Overdue: ${payload.task}`,
    ...layout("A task is overdue", `${payload.task} on ${payload.project} was due ${payload.due}.\n\n${payload.url}`),
  }),
  comment: (payload) => ({
    subject: `New comment on ${payload.entity}`,
    ...layout("New comment", `${payload.actor} commented on ${payload.entity}.\n\n${payload.excerpt}\n\n${payload.url}`),
  }),
  mention: (payload) => ({
    subject: `${payload.actor} mentioned you`,
    ...layout("You were mentioned", `${payload.actor} mentioned you on ${payload.entity}.\n\n${payload.excerpt}\n\n${payload.url}`),
  }),
  requirement_decision: (payload) => ({
    subject: `Requirement ${payload.decision}: ${payload.requirement}`,
    ...layout("Requirement decision", `${payload.requirement} was ${payload.decision}.\n\n${payload.url}`),
  }),
  change_request: (payload) => ({
    subject: `Change request ${payload.status}: ${payload.title}`,
    ...layout("Change request update", `${payload.title} on ${payload.project} is ${payload.status}.\n\n${payload.url}`),
  }),
  milestone: (payload) => ({
    subject: `Milestone ${payload.status}: ${payload.milestone}`,
    ...layout("Milestone update", `${payload.milestone} on ${payload.project} is ${payload.status}.\n\n${payload.url}`),
  }),
  lead_assigned: (payload) => ({
    subject: `Lead assigned: ${payload.lead}`,
    ...layout("A lead was assigned to you", `${payload.actor} assigned ${payload.lead} (${payload.code}) to you.\n\n${payload.reason}\n\n${payload.url}`),
  }),
  lead_follow_up: (payload) => ({
    subject: `Follow-up due: ${payload.lead}`,
    ...layout("A follow-up is due", `${payload.lead} needs attention.\n\n${payload.note}\n\n${payload.url}`),
  }),
  opportunity_stage: (payload) => ({
    subject: `${payload.opportunity} is now ${payload.stage}`,
    ...layout("Opportunity stage changed", `${payload.opportunity} moved from ${payload.from} to ${payload.stage}.\n\n${payload.url}`),
  }),
  srs: (payload) => ({
    subject: payload.title,
    ...layout(payload.title, `${payload.document}\n\n${payload.body}\n\nOpen the requirements workspace: ${payload.url.startsWith("http") ? payload.url : `${process.env.APP_URL?.replace(/\/$/, "") ?? ""}${payload.url}`}`),
  }),
  document: (payload) => ({
    subject: `Document shared: ${payload.file}`,
    ...layout("A document was shared", `${payload.actor} shared ${payload.file}.\n\n${payload.url}`),
  }),
};

export function renderTemplate(template: string, payload: Record<string, string>): RenderedEmail {
  const renderer = TEMPLATES[template];
  if (!renderer) {
    return {
      subject: payload.subject || "Notification from Elec",
      ...layout(payload.subject || "Notification", payload.body || "You have a new notification."),
    };
  }
  return renderer(payload);
}
