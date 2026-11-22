import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the limit", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(key, { limit: 5, windowMs: 60_000 });
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks the request that exceeds the limit within the window", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) checkRateLimit(key, { limit: 5, windowMs: 60_000 });
    const sixth = checkRateLimit(key, { limit: 5, windowMs: 60_000 });
    expect(sixth.allowed).toBe(false);
    expect(sixth.remaining).toBe(0);
  });

  it("resets the count once the window elapses", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) checkRateLimit(key, { limit: 5, windowMs: 60_000 });
    expect(checkRateLimit(key, { limit: 5, windowMs: 60_000 }).allowed).toBe(false);

    vi.setSystemTime(new Date("2026-03-10T12:01:01Z")); // > 60s later
    const afterReset = checkRateLimit(key, { limit: 5, windowMs: 60_000 });
    expect(afterReset.allowed).toBe(true);
  });

  it("tracks distinct keys independently (one abusive client doesn't block another)", () => {
    const keyA = `clientA-${Math.random()}`;
    const keyB = `clientB-${Math.random()}`;
    for (let i = 0; i < 5; i++) checkRateLimit(keyA, { limit: 5, windowMs: 60_000 });
    expect(checkRateLimit(keyA, { limit: 5, windowMs: 60_000 }).allowed).toBe(false);
    expect(checkRateLimit(keyB, { limit: 5, windowMs: 60_000 }).allowed).toBe(true);
  });
});

describe("getClientKey", () => {
  it("prefers the first entry of x-forwarded-for", () => {
    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
    });
    expect(getClientKey(req)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = new Request("https://example.com", { headers: { "x-real-ip": "203.0.113.9" } });
    expect(getClientKey(req)).toBe("203.0.113.9");
  });

  it("falls back to 'unknown' when neither header is present", () => {
    const req = new Request("https://example.com");
    expect(getClientKey(req)).toBe("unknown");
  });
});
