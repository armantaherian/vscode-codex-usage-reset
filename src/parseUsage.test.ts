import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseResetInventory, parseSessionRateLimits, parseUsageResponse } from "./parseUsage";

const now = 1_700_000_000_000;

describe("parseUsageResponse", () => {
  it("keeps a 5-hour primary window and a weekly secondary window", () => {
    const snapshot = parseUsageResponse({
      plan_type: "plus",
      rate_limit: {
        limit_reached: false,
        primary_window: {
          used_percent: 12,
          limit_window_seconds: 18000,
          reset_at: Math.floor(now / 1000) + 3 * 3600 + 12 * 60,
        },
        secondary_window: {
          used_percent: 41,
          limit_window_seconds: 604800,
          reset_at: Math.floor(now / 1000) + 4 * 86400 + 2 * 3600,
        },
      },
      rate_limit_reset_credits: { available_count: 3, applicable_available_count: 0 },
    }, now);

    assert.equal(snapshot.fiveHour?.label, "5h");
    assert.equal(snapshot.fiveHour?.usedPercent, 12);
    assert.equal(snapshot.weekly?.label, "Wk");
    assert.equal(snapshot.weekly?.usedPercent, 41);
    assert.equal(snapshot.bankedResets, 3);
    assert.equal(snapshot.applicableResets, 0);
    assert.equal(snapshot.planType, "plus");
  });

  it("labels a weekly-only primary window as weekly", () => {
    const snapshot = parseUsageResponse({
      plan_type: "team",
      rate_limit: {
        primary_window: {
          used_percent: 63,
          limit_window_seconds: 604800,
          reset_after_seconds: 1000,
        },
        secondary_window: null,
      },
    }, now);

    assert.equal(snapshot.fiveHour, null);
    assert.equal(snapshot.weekly?.usedPercent, 63);
    assert.equal(snapshot.weekly?.resetAtMs, now + 1_000_000);
    assert.equal(snapshot.bankedResets, null);
  });
});

describe("parseSessionRateLimits", () => {
  it("reads window minutes from a Codex session event", () => {
    const snapshot = parseSessionRateLimits({
      plan_type: "plus",
      primary: { used_percent: 2, window_minutes: 300, resets_at: 1_700_000_100 },
      secondary: { used_percent: 1, window_minutes: 10080, resets_at: 1_700_100_000 },
    }, now);

    assert.equal(snapshot?.fiveHour?.usedPercent, 2);
    assert.equal(snapshot?.weekly?.usedPercent, 1);
    assert.equal(snapshot?.source, "session");
    assert.equal(snapshot?.bankedResets, null);
  });
});

describe("parseResetInventory", () => {
  it("keeps future available credits and ignores redeemed ones", () => {
    const inventory = parseResetInventory({
      available_count: 2,
      credits: [
        { status: "redeemed", expires_at: Math.floor(now / 1000) + 500 },
        { status: "available", expires_at: Math.floor(now / 1000) + 5000 },
        { status: "available", expires_at: "2020-01-01T00:00:00.000Z" },
      ],
    }, now);

    assert.equal(inventory.available, 2);
    assert.equal(inventory.expiriesMs.length, 1);
    assert.equal(inventory.expiriesMs[0], (Math.floor(now / 1000) + 5000) * 1000);
  });
});
