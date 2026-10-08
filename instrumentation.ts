export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureRoleTemplates } = await import("@/lib/domain/bootstrap");
  await ensureRoleTemplates();
}
