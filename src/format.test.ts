import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatRemaining, formatStatus, severity, tooltipMarkdown } from "./format";
import { formatUsageCharts, renderUsageSvg, tileLevel } from "./tiles";
import { emptyHistory } from "./usageHistory";
import { parseUsageResponse } from "./parseUsage";
import type { ContextSnapshot, UsageSnapshot } from "./types";

const now = 1_700_000_000_000;

function plusUsage(): UsageSnapshot {
  return parseUsageResponse({
    plan_type: "plus",
    rate_limit: {
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
}

const context: ContextSnapshot = {
  remainingPercent: 93,
  usedTokens: 58_220,
  windowTokens: 828_400,
  cwd: "/work/app",
  atMs: now,
  matchedWorkspace: true,
};

describe("formatRemaining", () => {
  it("formats hours, days, and a due reset", () => {
    assert.equal(formatRemaining((3 * 3600 + 12 * 60) * 1000), "3h 12m");
    assert.equal(formatRemaining((4 * 86400 + 2 * 3600) * 1000), "4d 2h");
    assert.equal(formatRemaining(0), "now");
  });
});

describe("formatStatus", () => {
  it("shows 5-hour, weekly, remaining time, context, and banked resets", () => {
    assert.equal(
      formatStatus({ usage: plusUsage(), context, now }),
      "Codex 5h 12% (3h 12m) · Wk 41% (4d 2h) · Ctx 93% · ↺ 3",
    );
  });

  it("warns when the live quota is missing and a session snapshot is showing", () => {
    const usage = plusUsage();
    usage.source = "session";
    usage.bankedResets = null;
    assert.equal(
      formatStatus({ usage, now, problem: "Not signed in. Run `codex login`." }),
      "$(warning) Codex 5h 12% (3h 12m) · Wk 41% (4d 2h)",
    );
  });

  it("turns the bar red when a window is nearly full", () => {
    const usage = plusUsage();
    usage.fiveHour = usage.fiveHour && { ...usage.fiveHour, usedPercent: 95 };
    assert.equal(severity({ usage, now }), "error");
  });
});

describe("usage tiles", () => {
  it("draws a GitHub-style square for each weekday and hour", () => {
    const history = emptyHistory(now);
    history.cells[0][15] = 1_000;
    history.cells[0][16] = 4_000;
    history.totalTokens = 5_000;

    assert.equal(tileLevel(0, 4_000), 0);
    assert.equal(tileLevel(1_000, 4_000), 1);
    assert.equal(tileLevel(4_000, 4_000), 4);

    const { svg, width, height } = renderUsageSvg(history, "dark");
    assert.match(svg, /Mon/);
    assert.match(svg, />12a</);
    assert.match(svg, /#39d353/);
    assert.match(svg, /#0e4429/);
    assert.equal(svg.match(/<rect /g)?.length, 7 * 24 + 5);

    const chart = formatUsageCharts(history, "light");
    assert.match(chart, new RegExp(`<img alt="[^"]*" width="${width}" height="${height}" src="data:image/svg\\+xml;base64,`));
    const encoded = chart.match(/base64,([^"]+)/)?.[1] ?? "";
    assert.match(Buffer.from(encoded, "base64").toString("utf8"), /#216e39/);
    assert.match(chart, /Each square is one hour/);
  });
});

describe("tooltipMarkdown", () => {
  it("includes the quota table, context, and banked resets", () => {
    const markdown = tooltipMarkdown({ usage: plusUsage(), context, now });
    assert.match(markdown, /5-hour \| 12%/);
    assert.match(markdown, /Weekly \| 41%/);
    assert.match(markdown, /3h 12m/);
    assert.match(markdown, /Context remaining:\*\* 93%/);
    assert.match(markdown, /Banked resets available:\*\* 3/);
    assert.match(markdown, /does not redeem a reset/);
  });
});
