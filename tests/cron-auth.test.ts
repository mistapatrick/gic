import { describe, expect, it } from "vitest";
import { isAuthorizedBearer } from "@/lib/auth/cron-auth";

describe("isAuthorizedBearer (ingest route auth guard)", () => {
  const secret = "0123456789abcdef0123456789abcdef";

  it("accepts the correct bearer token", () => {
    expect(isAuthorizedBearer(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("rejects a missing Authorization header", () => {
    expect(isAuthorizedBearer(null, secret)).toBe(false);
    expect(isAuthorizedBearer(undefined, secret)).toBe(false);
  });

  it("rejects an empty Authorization header", () => {
    expect(isAuthorizedBearer("", secret)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(isAuthorizedBearer(`Bearer wrong-secret-value`, secret)).toBe(false);
  });

  it("rejects a near-miss (one character off) without throwing", () => {
    const almost = secret.slice(0, -1) + "X";
    expect(isAuthorizedBearer(`Bearer ${almost}`, secret)).toBe(false);
  });

  it("is case-sensitive on the scheme and the token", () => {
    expect(isAuthorizedBearer(`bearer ${secret}`, secret)).toBe(false);
    expect(isAuthorizedBearer(`Bearer ${secret.toUpperCase()}`, secret)).toBe(false);
  });

  it("rejects a header missing the 'Bearer ' scheme prefix", () => {
    expect(isAuthorizedBearer(secret, secret)).toBe(false);
  });

  it("rejects a header that merely starts with the right value but has extra trailing content", () => {
    expect(isAuthorizedBearer(`Bearer ${secret}extra`, secret)).toBe(false);
  });
});
