import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/actor";
import { requirePermission } from "@/lib/actor";
import { loadProject } from "@/lib/domain/access";
import { todayInTimeZone } from "@/lib/dates";
import { writeAudit } from "@/lib/domain/support";
import { conflict, validationError } from "@/lib/errors";
import { cleanText } from "@/lib/text";

export async function logTime(actor: Actor, input: { projectId: string; taskId?: string; workOn: string; minutes: number; note?: string }) {
  requirePermission(actor, "time.log");
  const project = await loadProject(prisma, actor, input.projectId);
  if (project.archivedAt) throw conflict("Archived projects cannot accept time.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workOn)) throw validationError("Choose a valid work date.", { workOn: "Use a valid date." });
  if (input.workOn > todayInTimeZone(actor.timezone)) throw validationError("Time cannot be logged in the future.", { workOn: "Choose today or an earlier date." });
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 12 * 60) {
    throw validationError("Enter between 1 and 720 minutes.", { minutes: "Enter between 1 and 720 minutes." });
  }
  const existing = await prisma.timeEntry.aggregate({ where: { userId: actor.userId, workOn: input.workOn }, _sum: { minutes: true } });
  if ((existing._sum.minutes ?? 0) + input.minutes > 24 * 60) {
    throw validationError("That entry would exceed 24 hours for the day.", { minutes: "Reduce the duration." });
  }
  const entry = await prisma.timeEntry.create({
    data: {
      organizationId: actor.organizationId,
      projectId: input.projectId,
      taskId: input.taskId,
      userId: actor.userId,
      workOn: input.workOn,
      minutes: input.minutes,
      note: cleanText(input.note ?? "", 1000),
    },
  });
  await writeAudit(prisma, actor, { action: "time.log", entityType: "time_entry", entityId: entry.id, after: { minutes: input.minutes, workOn: input.workOn } });
  return entry;
}

export async function correctTime(actor: Actor, id: string, minutes: number, reason: string) {
  const entry = await prisma.timeEntry.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!entry) throw validationError("Time entry not found.");
  if (entry.userId !== actor.userId) requirePermission(actor, "time.approve");
  if (entry.lockedAt) requirePermission(actor, "time.lock");
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 12 * 60) throw validationError("Enter between 1 and 720 minutes.");
  if (!reason.trim()) throw validationError("Explain the correction.", { reason: "A reason is required." });
  await prisma.$transaction([
    prisma.timeEntryRevision.create({ data: { timeEntryId: id, minutes: entry.minutes, note: entry.note, editorId: actor.userId, editorName: actor.name, reason: reason.trim() } }),
    prisma.timeEntry.update({ where: { id }, data: { minutes, version: { increment: 1 }, status: "corrected" } }),
  ]);
  await writeAudit(prisma, actor, { action: "time.correct", entityType: "time_entry", entityId: id, before: { minutes: entry.minutes }, after: { minutes, reason } });
}

export async function setTimeStatus(actor: Actor, id: string, status: "approved" | "locked") {
  requirePermission(actor, status === "locked" ? "time.lock" : "time.approve");
  const entry = await prisma.timeEntry.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!entry) throw validationError("Time entry not found.");
  await prisma.timeEntry.update({
    where: { id },
    data: status === "locked" ? { status: "locked", lockedAt: new Date() } : { status: "approved" },
  });
  await writeAudit(prisma, actor, { action: `time.${status}`, entityType: "time_entry", entityId: id });
}

export async function listTime(actor: Actor, query: { userId?: string; projectId?: string }) {
  requirePermission(actor, "time.view");
  const ownOnly = !actor.permissions.includes("time.approve") && !actor.permissions.includes("reports.view");
  return prisma.timeEntry.findMany({
    where: {
      organizationId: actor.organizationId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      userId: ownOnly ? actor.userId : query.userId,
    },
    orderBy: { workOn: "desc" },
    take: 200,
    include: { user: { select: { name: true } }, project: { select: { name: true, code: true } } },
  });
}
