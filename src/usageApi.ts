import { ensureFreshToken, loadAuth, refreshAndSave, type CodexAuth } from "./auth";
import { hasUsableUsage, parseResetInventory, parseUsageResponse } from "./parseUsage";
import type { UsageSnapshot } from "./types";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const RESETS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";

export async function loadLiveUsage(home: string): Promise<UsageSnapshot> {
  const auth = await loadAuth(home);
  if (!auth) {
    throw new Error("Not signed in. Run `codex login`.");
  }
  const fresh = await ensureFreshToken(auth);
  return requestUsage(fresh);
}

async function requestUsage(auth: CodexAuth): Promise<UsageSnapshot> {
  let current = auth;
  let response = await getJson(current, USAGE_URL);
  if (response.status === 401 && current.refreshToken) {
    current = await refreshAndSave(current);
    response = await getJson(current, USAGE_URL);
  }
  if (response.status === 401) {
    throw new Error("Codex login expired. Run `codex login`.");
  }
  if (response.status < 200 || response.status >= 300 || response.body === null) {
    throw new Error(`Codex usage request failed (${response.status}).`);
  }

  const now = Date.now();
  const snapshot = parseUsageResponse(response.body, now);
  if (!hasUsableUsage(snapshot)) {
    throw new Error("Codex usage response did not include rate limits.");
  }

  try {
    const inventory = await getJson(current, RESETS_URL);
    if (inventory.status >= 200 && inventory.status < 300 && inventory.body) {
      const parsed = parseResetInventory(inventory.body, now);
      if (snapshot.bankedResets === null && parsed.available !== null) {
        snapshot.bankedResets = parsed.available;
      }
      snapshot.resetExpiriesMs = parsed.expiriesMs;
    }
  } catch {
    // The usage payload already carries the available count.
  }
  return snapshot;
}

async function getJson(auth: CodexAuth, url: string): Promise<{ status: number; body: unknown | null }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${auth.accessToken}`,
    "User-Agent": "codex-usage-reset",
  };
  if (auth.accountId) {
    headers["ChatGPT-Account-Id"] = auth.accountId;
  }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  const text = await response.text();
  if (!text) {
    return { status: response.status, body: null };
  }
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, body: null };
  }
}
