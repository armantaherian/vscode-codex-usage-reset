import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import * as readline from "readline";
import type { UsageHistory } from "./types";

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface Sample {
  atMs: number;
  total: number;
}

let cache: { signature: string; history: UsageHistory } | undefined;

export function emptyHistory(now: number): UsageHistory {
  return {
    cells: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
    totalTokens: 0,
    fromMs: now - WINDOW_MS,
    toMs: now,
  };
}

export async function readUsageHistory(home: string, now = Date.now()): Promise<UsageHistory> {
  const files = await listRecentRollouts(home, now);
  const day = Math.floor(now / 86_400_000);
  const signature = `${day}|${files.map((file) => `${file.file}:${file.mtime}:${file.size}`).join("|")}`;
  if (cache?.signature === signature) {
    return cache.history;
  }
  const history = emptyHistory(now);
  for (const file of files) {
    await scanRollout(file.file, now, history);
  }
  history.totalTokens = history.cells.reduce((sum, row) => sum + row.reduce((rowSum, value) => rowSum + value, 0), 0);
  cache = { signature, history };
  return history;
}

async function listRecentRollouts(home: string, now: number): Promise<{ file: string; mtime: number; size: number }[]> {
  const dir = path.join(home, "sessions");
  let names: string[];
  try {
    names = await fsp.readdir(dir, { recursive: true, encoding: "utf8" });
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }
  const cutoff = now - WINDOW_MS;
  const files: { file: string; mtime: number; size: number }[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl") || !path.basename(name).startsWith("rollout-")) {
      continue;
    }
    const file = path.join(dir, name);
    try {
      const stat = await fsp.stat(file);
      if (stat.isFile() && stat.mtimeMs >= cutoff) {
        files.push({ file, mtime: stat.mtimeMs, size: stat.size });
      }
    } catch {
      // Codex can remove a rollout while it is being listed.
    }
  }
  return files;
}

async function scanRollout(file: string, now: number, history: UsageHistory): Promise<void> {
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let previous = 0;
  let seen = false;
  const start = now - WINDOW_MS;
  try {
    for await (const line of lines) {
      if (!line.includes('"token_count"')) {
        continue;
      }
      const sample = parseSample(line);
      if (!sample) {
        continue;
      }
      const delta = !seen || sample.total < previous ? sample.total : sample.total - previous;
      previous = sample.total;
      seen = true;
      if (delta <= 0 || sample.atMs < start || sample.atMs > now + 60_000) {
        continue;
      }
      const date = new Date(sample.atMs);
      const day = (date.getDay() + 6) % 7;
      history.cells[day][date.getHours()] += delta;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

function parseSample(line: string): Sample | undefined {
  try {
    const event = JSON.parse(line) as {
      timestamp?: unknown;
      payload?: { type?: unknown; info?: { total_token_usage?: { total_tokens?: unknown } } };
    };
    if (event.payload?.type !== "token_count") {
      return undefined;
    }
    const total = event.payload.info?.total_token_usage?.total_tokens;
    const atMs = typeof event.timestamp === "string" ? Date.parse(event.timestamp) : NaN;
    if (typeof total !== "number" || !Number.isFinite(total) || total < 0 || !Number.isFinite(atMs)) {
      return undefined;
    }
    return { atMs, total };
  } catch {
    return undefined;
  }
}

function isEnoent(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT";
}
