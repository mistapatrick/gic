import { describe, expect, it, vi } from "vitest";
import { APICallError, RetryError } from "ai";
import { AI_FALLBACK_CHAIN, GROQ_MODEL, withAiFallback } from "@/lib/ai-models";

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

describe("AI_FALLBACK_CHAIN", () => {
  it("has three entries: both Gemini models, then Groq last", () => {
    expect(AI_FALLBACK_CHAIN).toHaveLength(3);
    expect(AI_FALLBACK_CHAIN[0]).toEqual({ provider: "gemini", modelId: "gemini-3.5-flash-lite" });
    expect(AI_FALLBACK_CHAIN[1]).toEqual({ provider: "gemini", modelId: "gemini-3.1-flash-lite" });
    expect(AI_FALLBACK_CHAIN[2]).toEqual({ provider: "groq", modelId: GROQ_MODEL });
  });
});

describe("withAiFallback", () => {
  it("returns the result on first success without falling back", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    const result = await withAiFallback(run);
    expect(result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("falls back to the next model on a 503 (high demand)", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(retryableApiError(503))
      .mockResolvedValueOnce("ok-from-fallback");
    const result = await withAiFallback(run);
    expect(result).toBe("ok-from-fallback");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("falls back on a 429 (per-model quota exhausted)", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(retryableApiError(429))
      .mockResolvedValueOnce("ok-from-fallback");
    const result = await withAiFallback(run);
    expect(result).toBe("ok-from-fallback");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("falls back on a bare TimeoutError (not an APICallError)", async () => {
    const run = vi.fn().mockRejectedValueOnce(timeoutError()).mockResolvedValueOnce("ok-from-fallback");
    const result = await withAiFallback(run);
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
    const result = await withAiFallback(run);
    expect(result).toBe("ok-from-fallback");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not fall back on a non-retryable error (e.g. a bad API key) — fails fast instead", async () => {
    const err = nonRetryableApiError();
    const run = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce("should-not-be-reached");
    await expect(withAiFallback(run)).rejects.toBe(err);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("throws the last error once every entry in the chain has failed", async () => {
    const errors = AI_FALLBACK_CHAIN.map(() => retryableApiError(503));
    const run = vi.fn();
    errors.forEach((e) => run.mockRejectedValueOnce(e));
    await expect(withAiFallback(run)).rejects.toBe(errors[errors.length - 1]);
    expect(run).toHaveBeenCalledTimes(AI_FALLBACK_CHAIN.length);
  });

  it("passes each chain entry's constructed model instance through to run, in order", async () => {
    const seen: unknown[] = [];
    const run = vi.fn(async (model: unknown) => {
      seen.push(model);
      throw retryableApiError(503);
    });
    await expect(withAiFallback(run)).rejects.toBeTruthy();
    expect(seen).toHaveLength(AI_FALLBACK_CHAIN.length);
  });

  it("falls all the way back to Groq when both Gemini models fail retryably — the previously-missing third leg", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(retryableApiError(503))
      .mockRejectedValueOnce(retryableApiError(503))
      .mockResolvedValueOnce("ok-from-groq");
    const result = await withAiFallback(run);
    expect(result).toBe("ok-from-groq");
    expect(run).toHaveBeenCalledTimes(3);
  });
});
