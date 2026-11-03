import { asNumber, asRecord, asString } from "./json";
import type { UsageSnapshot, UsageWindow } from "./types";

const FIVE_HOUR_MAX_SECONDS = 8 * 60 * 60;
const WEEKLY_MIN_SECONDS = 5 * 24 * 60 * 60;

export function emptySnapshot(source: UsageSnapshot["source"], fetchedAtMs: number): UsageSnapshot {
  return {
    source,
    fetchedAtMs,
    planType: null,
    limitReached: false,
    fiveHour: null,
    weekly: null,
    extra: [],
    bankedResets: null,
    applicableResets: null,
    resetExpiriesMs: [],
    creditsBalance: null,
  };
}

export function hasUsableUsage(snapshot: UsageSnapshot | undefined): snapshot is UsageSnapshot {
  return !!snapshot && (!!snapshot.fiveHour || !!snapshot.weekly || snapshot.extra.length > 0 || snapshot.bankedResets !== null);
}

/**
 * Codex moves the only enforced window between primary and secondary by plan.
 * A weekly window often arrives in `primary_window`, so the duration — not the slot — picks the label.
 */
export function classifyWindow(windowSeconds: number | null, slot: "primary" | "secondary"): Pick<UsageWindow, "id" | "label" | "statusLabel"> {
  if (windowSeconds === null) {
    return slot === "secondary"
      ? { id: "weekly", label: "Wk", statusLabel: "Weekly" }
      : { id: "5h", label: "5h", statusLabel: "5-hour" };
  }
  if (windowSeconds <= FIVE_HOUR_MAX_SECONDS) {
    return { id: "5h", label: "5h", statusLabel: "5-hour" };
  }
  if (windowSeconds >= WEEKLY_MIN_SECONDS) {
    return { id: "weekly", label: "Wk", statusLabel: "Weekly" };
  }
  const hours = Math.max(1, Math.round(windowSeconds / 3600));
  const label = hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;
  return { id: "other", label, statusLabel: label };
}

export function parseUsageResponse(payload: unknown, now: number): UsageSnapshot {
  const root = asRecord(payload) ?? {};
  const nested = asRecord(root.data);
  const rate = asRecord(root.rate_limit) ?? asRecord(nested?.rate_limit) ?? {};
  const snapshot = emptySnapshot("api", now);
  snapshot.planType = asString(root.plan_type) ?? asString(nested?.plan_type);
  snapshot.limitReached = rate.limit_reached === true || typeof root.rate_limit_reached_type === "string" || typeof rate.rate_limit_reached_type === "string";
  assignWindow(snapshot, parseLooseWindow(rate.primary_window, "primary", now));
  assignWindow(snapshot, parseLooseWindow(rate.secondary_window, "secondary", now));
  applyResetCredits(snapshot, root.rate_limit_reset_credits);
  applyCreditBalance(snapshot, root.credits);
  return snapshot;
}

export function parseSessionRateLimits(raw: unknown, atMs: number): UsageSnapshot | undefined {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  const snapshot = emptySnapshot("session", atMs);
  snapshot.planType = asString(record.plan_type);
  snapshot.limitReached = record.limit_reached === true || typeof record.rate_limit_reached_type === "string";
  assignWindow(snapshot, parseLooseWindow(record.primary, "primary", atMs));
  assignWindow(snapshot, parseLooseWindow(record.secondary, "secondary", atMs));
  applyCreditBalance(snapshot, record.credits);
  return hasUsableUsage(snapshot) ? snapshot : undefined;
}

export function parseResetInventory(payload: unknown, now: number): { available: number | null; expiriesMs: number[] } {
  const root = asRecord(payload) ?? {};
  const available = countOrNull(root.available_count);
  const expiries: number[] = [];
  const list = Array.isArray(root.credits) ? root.credits : [];
  for (const item of list) {
    const credit = asRecord(item);
    if (!credit) {
      continue;
    }
    if (typeof credit.status === "string" && credit.status !== "available") {
      continue;
    }
    const when = parseTimeMs(credit.expires_at);
    if (when !== null && when > now) {
      expiries.push(when);
    }
  }
  expiries.sort((a, b) => a - b);
  return { available, expiriesMs: expiries };
}

export function parseLooseWindow(raw: unknown, slot: "primary" | "secondary", now: number): UsageWindow | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const used = asNumber(record.used_percent);
  if (used === null) {
    return null;
  }
  const minutes = asNumber(record.window_minutes);
  const seconds = asNumber(record.limit_window_seconds) ?? (minutes === null ? null : minutes * 60);
  const resetAt = asNumber(record.reset_at) ?? asNumber(record.resets_at);
  const resetAfter = asNumber(record.reset_after_seconds) ?? asNumber(record.resets_in_seconds);
  const classified = classifyWindow(seconds, slot);
  return {
    ...classified,
    usedPercent: clampPercent(used),
    resetAtMs: resetAt !== null ? unixMs(resetAt) : resetAfter !== null ? now + resetAfter * 1000 : null,
  };
}

function assignWindow(snapshot: UsageSnapshot, window: UsageWindow | null): void {
  if (!window) {
    return;
  }
  if (window.id === "5h") {
    if (!snapshot.fiveHour || window.usedPercent > snapshot.fiveHour.usedPercent) {
      snapshot.fiveHour = window;
    }
    return;
  }
  if (window.id === "weekly") {
    if (!snapshot.weekly || window.usedPercent > snapshot.weekly.usedPercent) {
      snapshot.weekly = window;
    }
    return;
  }
  snapshot.extra.push(window);
}

function applyResetCredits(snapshot: UsageSnapshot, raw: unknown): void {
  const resets = asRecord(raw);
  if (!resets) {
    return;
  }
  snapshot.bankedResets = countOrNull(resets.available_count);
  snapshot.applicableResets = countOrNull(resets.applicable_available_count);
}

function applyCreditBalance(snapshot: UsageSnapshot, raw: unknown): void {
  const credits = asRecord(raw);
  const balance = asString(credits?.balance);
  if (credits?.has_credits === true && credits.unlimited !== true && balance) {
    snapshot.creditsBalance = balance;
  }
}

function countOrNull(value: unknown): number | null {
  const count = asNumber(value);
  return count === null ? null : Math.max(0, Math.round(count));
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unixMs(value: number): number {
  return value > 1e12 ? value : value * 1000;
}

export function parseTimeMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return unixMs(value);
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim().match(/^\d+(\.\d+)?$/)) {
      return unixMs(numeric);
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
