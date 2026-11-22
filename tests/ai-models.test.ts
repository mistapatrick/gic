import { describe, expect, it, vi } from "vitest";
import { APICallError, RetryError } from "ai";
import { GEMINI_FALLBACK_CHAIN, withGeminiFallback } from "@/lib/ai-models";

function retryableApiError(statusCode: number) {
  return new APICallError({
    message: "This model is currently experiencing high demand.",
    url: "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent",
    requestBodyValues: {},
    statusCode,
    isRetryable: statusCode >= 500,
  });
}

function nonRetryableApiError() {
  return new APICallError({
    message: "API key not valid.",
    url: "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent",
    requestBodyValues: {},
    statusCode: 400,
    isRetryable: false,
  });
}

function timeoutError() {
  const err = new Error("The operation was aborted due to timeout");
  err.name = "TimeoutError";
  return err;
}

describe("withGeminiFallback", () => {
  it("returns the result on first success without falling back", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    const result = await withGeminiFallback(run);
    expect(result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("falls back to the next model on a 503 (high demand)", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(retryableApiError(503))
      .mockResolvedValueOnce("ok-from-fallback");
    const result = await withGeminiFallback(run);
    expect(result).toBe("ok-from-fallback");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("falls back on a 429 (per-model quota exhausted)", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(retryableApiError(429))
      .mockResolvedValueOnce("ok-from-fallback");
    const result = await withGeminiFallback(run);
    expect(result).toBe("ok-from-fallback");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("falls back on a bare TimeoutError (not an APICallError)", async () => {
    const run = vi.fn().mockRejectedValueOnce(timeoutError()).mockResolvedValueOnce("ok-from-fallback");
    const result = await withGeminiFallback(run);
    expect(result).toBe("ok-from-fallback");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("unwraps a RetryError (what generateText/generateObject actually throw after exhausting their own retries) and still falls back", async () => {
    const underlying = retryableApiError(503);
    const retryError = new RetryError({
      message: "Failed after 3 attempts.",
      reason: "maxRetriesExceeded",
      errors: [underlying, underlying, underlying],
    });
    const run = vi.fn().mockRejectedValueOnce(retryError).mockResolvedValueOnce("ok-from-fallback");
    const result = await withGeminiFallback(run);
    expect(result).toBe("ok-from-fallback");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not fall back on a non-retryable error (e.g. a bad API key) — fails fast instead", async () => {
    const err = nonRetryableApiError();
    const run = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce("should-not-be-reached");
    await expect(withGeminiFallback(run)).rejects.toBe(err);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("throws the last error once every model in the chain has failed", async () => {
    const errors = GEMINI_FALLBACK_CHAIN.map(() => retryableApiError(503));
    const run = vi.fn();
    errors.forEach((e) => run.mockRejectedValueOnce(e));
    await expect(withGeminiFallback(run)).rejects.toBe(errors[errors.length - 1]);
    expect(run).toHaveBeenCalledTimes(GEMINI_FALLBACK_CHAIN.length);
  });

  it("passes each chain model's constructed model instance through to run, in order", async () => {
    const seen: unknown[] = [];
    const run = vi.fn(async (model: unknown) => {
      seen.push(model);
      throw retryableApiError(503);
    });
    await expect(withGeminiFallback(run)).rejects.toBeTruthy();
    expect(seen).toHaveLength(GEMINI_FALLBACK_CHAIN.length);
  });
});
