import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tokenExpiryMs } from "./auth";

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
