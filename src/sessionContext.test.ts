import assert from "node:assert/strict";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, it } from "node:test";
import { readSessionSnapshot } from "./sessionContext";

function tokenLine(usedPercent: number, totalTokens: number, window = 1000): string {
  return JSON.stringify({
    timestamp: "2026-11-02T16:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: { input_tokens: totalTokens - 10, total_tokens: totalTokens },
        model_context_window: window,
      },
      rate_limits: {
        plan_type: "plus",
        primary: { used_percent: usedPercent, window_minutes: 300, resets_at: 1_800_000_000 },
        secondary: { used_percent: 4, window_minutes: 10080, resets_at: 1_800_100_000 },
      },
    },
  });
}

async function writeRollout(root: string, name: string, cwd: string, body: string, mtime: Date): Promise<void> {
  const file = path.join(root, "sessions", "2026", "11", "02", name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const meta = JSON.stringify({
    type: "session_meta",
    payload: { cwd, session_id: name },
  });
  await fs.writeFile(file, `${meta}\n${body}\n`);
  const seconds = mtime.getTime() / 1000;
  await fs.utimes(file, seconds, seconds);
}

describe("readSessionSnapshot", () => {
  it("prefers the workspace session over a newer session elsewhere", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-usage-"));
    await writeRollout(home, "rollout-old.jsonl", "/work/app", `${tokenLine(10, 250)}\n${tokenLine(22, 400)}`, new Date("2026-11-01T00:00:00Z"));
    await writeRollout(home, "rollout-new.jsonl", "/other", tokenLine(80, 900), new Date("2026-11-02T00:00:00Z"));

    const snapshot = await readSessionSnapshot(home, ["/work/app"]);
    assert.equal(snapshot?.usage?.fiveHour?.usedPercent, 22);
    assert.equal(snapshot?.context?.remainingPercent, 60);
    assert.equal(snapshot?.context?.matchedWorkspace, true);
    assert.equal(snapshot?.context?.cwd, "/work/app");
  });

  it("prefers a newer session inside the workspace over an older exact match", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-usage-"));
    await writeRollout(home, "rollout-old.jsonl", "/work/app", tokenLine(10, 100), new Date("2026-11-01T00:00:00Z"));
    await writeRollout(home, "rollout-new.jsonl", "/work/app/pkg", tokenLine(55, 200), new Date("2026-11-02T00:00:00Z"));

    const snapshot = await readSessionSnapshot(home, ["/work/app"]);
    assert.equal(snapshot?.usage?.fiveHour?.usedPercent, 55);
    assert.equal(snapshot?.context?.matchedWorkspace, true);
  });

  it("uses the newest session when none match the workspace", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-usage-"));
    await writeRollout(home, "rollout-old.jsonl", "/work/app", tokenLine(10, 100), new Date("2026-11-01T00:00:00Z"));
    await writeRollout(home, "rollout-new.jsonl", "/other", tokenLine(80, 900), new Date("2026-11-02T00:00:00Z"));

    const snapshot = await readSessionSnapshot(home, ["/somewhere/else"]);
    assert.equal(snapshot?.usage?.fiveHour?.usedPercent, 80);
    assert.equal(snapshot?.context?.matchedWorkspace, false);
  });
});
