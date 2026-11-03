import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { loadAuth, refreshAndSave, tokenExpiryMs } from "./auth";

function jwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${header}.${body}.sig`;
}

describe("tokenExpiryMs", () => {
  it("reads the exp claim without treating the token as a secret", () => {
    assert.equal(tokenExpiryMs(jwt(1_700_000_000)), 1_700_000_000_000);
    assert.equal(tokenExpiryMs("not-a-jwt"), null);
  });
});

describe("refreshAndSave", () => {
  const now = 1_700_000_000_000;
  const expiring = jwt(1_700_000_030);
  const expiringOther = jwt(1_700_000_045);
  const fresh = jwt(1_700_003_600);
  const refreshed = jwt(1_700_007_200);
  const realFetch = globalThis.fetch;
  let dir: string;
  let sentRefreshTokens: (string | null)[];

  async function saveAuth(accessToken: string, refreshToken: string): Promise<void> {
    const data = { tokens: { access_token: accessToken, refresh_token: refreshToken, account_id: "acct" } };
    await fs.writeFile(path.join(dir, "auth.json"), JSON.stringify(data));
  }

  async function loadSaved() {
    const auth = await loadAuth(dir);
    assert.ok(auth);
    return auth;
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-auth-"));
    sentRefreshTokens = [];
    globalThis.fetch = async (_url: unknown, init?: { body?: unknown }) => {
      sentRefreshTokens.push(new URLSearchParams(String(init?.body)).get("refresh_token"));
      return new Response(JSON.stringify({ access_token: refreshed, refresh_token: "rt-new" }), { status: 200 });
    };
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("refreshes and saves when nobody else has", async () => {
    await saveAuth(expiring, "rt-1");
    const result = await refreshAndSave(await loadSaved(), now);

    assert.deepEqual(sentRefreshTokens, ["rt-1"]);
    assert.equal(result.accessToken, refreshed);
    const saved = await loadSaved();
    assert.equal(saved.accessToken, refreshed);
    assert.equal(saved.refreshToken, "rt-new");
  });

  it("uses a login another process already refreshed instead of reusing the old refresh token", async () => {
    await saveAuth(expiring, "rt-1");
    const loaded = await loadSaved();
    await saveAuth(fresh, "rt-2");

    const result = await refreshAndSave(loaded, now);

    assert.deepEqual(sentRefreshTokens, []);
    assert.equal(result.accessToken, fresh);
    assert.equal(result.refreshToken, "rt-2");
  });

  it("refreshes from the saved login when it is about to expire too", async () => {
    await saveAuth(expiring, "rt-1");
    const loaded = await loadSaved();
    await saveAuth(expiringOther, "rt-2");

    const result = await refreshAndSave(loaded, now);

    assert.deepEqual(sentRefreshTokens, ["rt-2"]);
    assert.equal(result.accessToken, refreshed);
  });
});
