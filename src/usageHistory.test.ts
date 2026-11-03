import assert from "node:assert/strict";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, it } from "node:test";
import { readUsageHistory } from "./usageHistory";

function tokenLine(at: Date, total: number): string {
  return JSON.stringify({
    timestamp: at.toISOString(),
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: { total_tokens: total } },
    },
  });
}

describe("readUsageHistory", () => {
  it("buckets new tokens by local hour and weekday over the last 7 days", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-usage-history-"));
    const now = new Date(2026, 10, 2, 18, 0, 0).getTime();
    const earlier = new Date(now - 8 * 24 * 60 * 60 * 1000);
    const hour15 = new Date(2026, 10, 2, 15, 30, 0);
    const hour16 = new Date(2026, 10, 2, 16, 45, 0);
    const file = path.join(home, "sessions", "2026", "11", "02", "rollout-week.jsonl");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, [
      tokenLine(earlier, 10_000),
      tokenLine(hour15, 11_000),
      tokenLine(hour16, 12_500),
      "",
    ].join("\n"));
    const seconds = now / 1000;
    await fs.utimes(file, seconds, seconds);

    const history = await readUsageHistory(home, now);
    const day = (hour15.getDay() + 6) % 7;
    assert.equal(history.cells[day][15], 1_000);
    assert.equal(history.cells[day][16], 1_500);
    assert.equal(history.totalTokens, 2_500);
  });
});
