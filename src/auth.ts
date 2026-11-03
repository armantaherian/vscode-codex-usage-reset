import * as fs from "fs/promises";
import * as path from "path";
import { asRecord, asString } from "./json";

const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

export interface CodexAuth {
  accessToken: string;
  refreshToken: string | null;
  accountId: string | null;
  authPath: string;
}

export function tokenExpiryMs(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export async function loadAuth(home: string): Promise<CodexAuth | null> {
  const authPath = path.join(home, "auth.json");
  let raw: string;
  try {
    raw = await fs.readFile(authPath, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return null;
    }
    throw new Error("Could not read Codex auth.json.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Codex auth.json is not valid.");
  }
  const tokens = asRecord(asRecord(parsed)?.tokens);
  const accessToken = asString(tokens?.access_token);
  if (!accessToken) {
    return null;
  }
  return {
    accessToken,
    refreshToken: asString(tokens?.refresh_token),
    accountId: asString(tokens?.account_id),
    authPath,
  };
}

export async function ensureFreshToken(auth: CodexAuth, now = Date.now()): Promise<CodexAuth> {
  const expiry = tokenExpiryMs(auth.accessToken);
  if (expiry === null || expiry - now > 60_000) {
    return auth;
  }
  return refreshAndSave(auth);
}

export async function refreshAndSave(auth: CodexAuth): Promise<CodexAuth> {
  if (!auth.refreshToken) {
    throw new Error("Codex login expired. Run `codex login`.");
  }
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: auth.refreshToken,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error("Codex login expired. Run `codex login`.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Codex login expired. Run `codex login`.");
  }
  const record = asRecord(payload);
  const accessToken = asString(record?.access_token);
  if (!accessToken) {
    throw new Error("Codex login expired. Run `codex login`.");
  }
  const refreshToken = asString(record?.refresh_token) ?? auth.refreshToken;
  const idToken = asString(record?.id_token);
  await writeTokens(auth.authPath, { accessToken, refreshToken, idToken });
  return { ...auth, accessToken, refreshToken };
}

async function writeTokens(authPath: string, tokens: { accessToken: string; refreshToken: string; idToken: string | null }): Promise<void> {
  const data = asRecord(JSON.parse(await fs.readFile(authPath, "utf8")));
  if (!data) {
    throw new Error("Codex auth.json is not valid.");
  }
  const existing = asRecord(data.tokens) ?? {};
  existing.access_token = tokens.accessToken;
  existing.refresh_token = tokens.refreshToken;
  if (tokens.idToken) {
    existing.id_token = tokens.idToken;
  }
  data.tokens = existing;
  data.last_refresh = new Date().toISOString();
  const tmp = `${authPath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, authPath);
}

function isEnoent(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT";
}
