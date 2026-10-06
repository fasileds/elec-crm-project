import { describe, expect, it } from "vitest";
import { scoreProjectHealth } from "@/lib/domain/health";
import { detectUpload } from "@/lib/files/sniff";
import { verifyResendSignature } from "@/lib/email/webhook";
import { createHmac } from "node:crypto";
import { formatMoney, parseMoneyToCents } from "@/lib/money";
import { isPastDate, todayInTimeZone } from "@/lib/dates";
import { canTransition, PROJECT_TRANSITIONS } from "@/lib/domain/workflow";
import { arrangeWidgets, lensFor, moveWidget, widgetsFor } from "@/lib/domain/dashboard-layout";

describe("project health", () => {
  it("stays healthy when nothing is late", () => {
    const health = scoreProjectHealth({ overdueMilestones: 0, overdueCriticalTasks: 0, overdueTasks: 0, blockedTasks: 0, openBlockers: 0, dueWithinThreeDays: 0, openChangeRequests: 0, scopeChangesAfterBaseline: 0, managerInactive: false });
    expect(health.status).toBe("healthy");
    expect(health.score).toBe(100);
  });

  it("becomes critical when overdue critical work and blockers stack up", () => {
    const health = scoreProjectHealth({ overdueMilestones: 1, overdueCriticalTasks: 2, overdueTasks: 2, blockedTasks: 1, openBlockers: 1, dueWithinThreeDays: 1, openChangeRequests: 1, scopeChangesAfterBaseline: 1, managerInactive: true });
    expect(health.status).toBe("critical");
    expect(health.reasons.length).toBeGreaterThan(3);
  });
});

describe("files", () => {
  it("rejects executables and mismatched contents", () => {
    expect(detectUpload("payload.exe", new Uint8Array([0x4d, 0x5a, 0x00])).ok).toBe(false);
    expect(detectUpload("notes.pdf", new Uint8Array([0x89, 0x50, 0x4e, 0x47])).ok).toBe(false);
    expect(detectUpload("notes.pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])).ok).toBe(true);
  });
});

describe("resend webhooks", () => {
  it("accepts a current signature and rejects a replay outside the window", () => {
    const secret = `whsec_${Buffer.from("test-secret").toString("base64")}`;
    const body = JSON.stringify({ type: "email.delivered" });
    const timestamp = "1700000000";
    const digest = createHmac("sha256", Buffer.from("test-secret")).update(`msg_1.${timestamp}.${body}`).digest("base64");
    expect(verifyResendSignature({ secret, id: "msg_1", timestamp, signature: `v1,${digest}`, body, now: 1700000000 })).toBe(true);
    expect(verifyResendSignature({ secret, id: "msg_1", timestamp, signature: `v1,${digest}`, body, now: 1700000401 })).toBe(false);
  });
});

describe("money and dates", () => {
  it("keeps currency in cents and compares dates in the organization timezone", () => {
    expect(parseMoneyToCents("12.30")).toBe(1230);
    expect(parseMoneyToCents("12.345")).toBeNull();
    expect(formatMoney(1230, "USD", "en-US")).toContain("12.30");
    expect(isPastDate("2026-10-04", "UTC", new Date("2026-10-05T01:00:00Z"))).toBe(true);
    expect(todayInTimeZone("UTC", new Date("2026-10-05T23:30:00Z"))).toBe("2026-10-05");
  });
});

describe("workflow", () => {
  it("refuses an illegal project jump", () => {
    expect(canTransition(PROJECT_TRANSITIONS, "draft", "active")).toBe(false);
    expect(canTransition(PROJECT_TRANSITIONS, "planning", "active")).toBe(true);
  });
});

describe("dashboard layout", () => {
  it("keeps role widgets and ignores saved ids the role cannot see", () => {
    expect(lensFor(["settings.manage"]).id).toBe("administrator");
    expect(lensFor(["leads.view", "customers.view"]).id).toBe("sales");
    expect(widgetsFor(["tasks.view", "tasks.edit"])).toEqual(["attention", "mine", "deadlines", "health", "activity"]);
    expect(arrangeWidgets(["commercial", "mine", "mine"], ["attention", "mine"])).toEqual(["mine", "attention"]);
    expect(moveWidget(["attention", "mine"], "mine", "up")).toEqual(["mine", "attention"]);
    expect(moveWidget(["attention"], "attention", "up")).toEqual(["attention"]);
  });
});
