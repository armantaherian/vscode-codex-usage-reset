import * as fs from "fs/promises";
import * as path from "path";
import { asNumber, asRecord } from "./json";
import { parseSessionRateLimits } from "./parseUsage";
import type { ContextSnapshot, SessionSnapshot } from "./types";

interface TokenCountEvent {
  timestamp?: unknown;
  payload?: {
    type?: unknown;
    info?: unknown;
    rate_limits?: unknown;
  };
}

export async function readSessionSnapshot(home: string, workspacePaths: string[]): Promise<SessionSnapshot | undefined> {
  const dir = path.join(home, "sessions");
  let names: string[];
  try {
    names = await fs.readdir(dir, { recursive: true, encoding: "utf8" });
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }

  const files: { file: string; mtime: number }[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl") || !path.basename(name).startsWith("rollout-")) {
      continue;
    }
    const file = path.join(dir, name);
    try {
      const stat = await fs.stat(file);
      if (stat.isFile()) {
        files.push({ file, mtime: stat.mtimeMs });
      }
    } catch {
      // The file can disappear while Codex rotates sessions.
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);

  let insideWorkspace: string | undefined;
  let parentOfWorkspace: string | undefined;
  let newest: string | undefined;
  for (const candidate of files.slice(0, 40)) {
    newest = newest ?? candidate.file;
    const cwd = await readSessionCwd(candidate.file);
    const score = matchScore(cwd, workspacePaths);
    if (score >= 2) {
      insideWorkspace = candidate.file;
      break;
    }
    if (score === 1 && !parentOfWorkspace) {
      parentOfWorkspace = candidate.file;
    }
  }
  const best = insideWorkspace ?? parentOfWorkspace ?? newest;
  if (!best) {
    return undefined;
  }

  const event = await readLastTokenCount(best);
  if (!event) {
    return undefined;
  }
  const cwd = await readSessionCwd(best);
  const atMs = eventTime(event);
  const usage = parseSessionRateLimits(event.payload?.rate_limits, atMs);
  const context = parseContext(event, cwd, best === insideWorkspace || best === parentOfWorkspace);
  if (!usage && !context) {
    return undefined;
  }
  return { usage, context };
}

async function readSessionCwd(file: string): Promise<string | null> {
  const fh = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const head = buf.subarray(0, bytesRead).toString("utf8");
    const match = /"cwd":"((?:\\.|[^"\\])*)"/.exec(head);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(`"${match[1]}"`) as string;
    } catch {
      return match[1];
    }
  } finally {
    await fh.close();
  }
}

async function readLastTokenCount(file: string): Promise<TokenCountEvent | undefined> {
  const fh = await fs.open(file, "r");
  try {
    const { size } = await fh.stat();
    let position = size;
    let pending = "";
    let scanned = 0;
    const chunkSize = 1024 * 1024;
    const limit = 8 * 1024 * 1024;
    while (position > 0 && scanned < limit) {
      const bytes = Math.min(chunkSize, position);
      position -= bytes;
      scanned += bytes;
      const buf = Buffer.alloc(bytes);
      await fh.read(buf, 0, bytes, position);
      const text = buf.toString("utf8") + pending;
      const lines = text.split("\n");
      pending = position > 0 ? lines[0] : "";
      const firstComplete = position > 0 ? 1 : 0;
      for (let i = lines.length - 1; i >= firstComplete; i--) {
        const event = parseTokenCountLine(lines[i]);
        if (event) {
          return event;
        }
      }
    }
    return undefined;
  } finally {
    await fh.close();
  }
}

function parseTokenCountLine(line: string): TokenCountEvent | undefined {
  if (!line.includes("token_count")) {
    return undefined;
  }
  try {
    const event = JSON.parse(line) as TokenCountEvent;
    return event.payload?.type === "token_count" ? event : undefined;
  } catch {
    return undefined;
  }
}

function parseContext(event: TokenCountEvent, cwd: string | null, matchedWorkspace: boolean): ContextSnapshot | undefined {
  const info = asRecord(event.payload?.info);
  const windowTokens = asNumber(info?.model_context_window);
  const last = asRecord(info?.last_token_usage);
  const usedTokens = asNumber(last?.total_tokens) ?? asNumber(last?.input_tokens);
  if (windowTokens === null || windowTokens <= 0 || usedTokens === null || usedTokens < 0) {
    return undefined;
  }
  const remaining = Math.max(0, windowTokens - usedTokens);
  return {
    remainingPercent: Math.max(0, Math.min(100, Math.round((remaining / windowTokens) * 100))),
    usedTokens,
    windowTokens,
    cwd,
    atMs: eventTime(event),
    matchedWorkspace,
  };
}

function eventTime(event: TokenCountEvent): number {
  const parsed = typeof event.timestamp === "string" ? Date.parse(event.timestamp) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function matchScore(cwd: string | null, workspacePaths: string[]): number {
  if (!cwd) {
    return 0;
  }
  let best = 0;
  const session = path.resolve(cwd);
  for (const workspace of workspacePaths) {
    const root = path.resolve(workspace);
    if (session === root) {
      return 3;
    }
    if (isInside(session, root)) {
      best = Math.max(best, 2);
    } else if (isInside(root, session)) {
      best = Math.max(best, 1);
    }
  }
  return best;
}

function isInside(child: string, parent: string): boolean {
  const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(prefix);
}

function isEnoent(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT";
}
