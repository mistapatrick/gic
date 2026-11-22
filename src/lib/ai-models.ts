import { google } from "@ai-sdk/google";
import { APICallError, RetryError } from "ai";

/**
 * Primary + fallback Gemini models for both the ingest and chat routes.
 *
 * Model choice here is driven by Google AI Studio's *free-tier daily quota*
 * (RPD), not just by raw capability, because this project runs on the free
 * tier. The standard Flash tier (gemini-3.5-flash, gemini-3.8-flash, ...) is
 * capped at roughly 20 requests/day on the free tier — easily exhausted by
 * one nightly ingest run plus a handful of manual "Ask the analyst" chats in
 * the same day. The Flash-Lite tier gets a far more generous ~500 requests/
 * day on the same free tier, which is why both models below are Flash-Lite,
 * not plain Flash.
 *
 * The two entries are deliberately different model generations (3.5 vs 3.1)
 * so a capacity spike on one model's pool doesn't take out the fallback too:
 * Gemini's "model is currently experiencing high demand" 503s are tracked
 * per model, so a different model often succeeds during the same window.
 */
export const GEMINI_FALLBACK_CHAIN = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"] as const;

type GeminiModelId = (typeof GEMINI_FALLBACK_CHAIN)[number];

/**
 * Whether it's worth retrying this error against the *next* model in the
 * chain. A transient server-side condition (503 high demand, 500, 429 quota
 * — quota is tracked per model, so a different model has its own budget,
 * any 5xx, a request timeout) is worth a second attempt elsewhere. A client
 * error (bad API key, invalid request shape) will fail identically on every
 * model in the chain, so don't waste the fallback attempt on those — surface
 * it immediately instead.
 */
function isRetryableAiError(err: unknown): boolean {
  if (RetryError.isInstance(err)) {
    return isRetryableAiError(err.lastError);
  }
  if (APICallError.isInstance(err)) {
    return err.isRetryable || err.statusCode === 429;
  }
  // Fetch/AbortSignal timeouts surface as a plain Error named "TimeoutError",
  // not an APICallError — still worth trying the next model for.
  return err instanceof Error && err.name === "TimeoutError";
}

/**
 * Runs `run` against each model in GEMINI_FALLBACK_CHAIN in order, moving to
 * the next one only on a retryable failure. Returns the first success, or
 * re-throws the last error once the chain is exhausted (or immediately, for
 * a non-retryable error).
 */
export async function withGeminiFallback<T>(
  run: (model: ReturnType<typeof google>) => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < GEMINI_FALLBACK_CHAIN.length; i++) {
    const modelId: GeminiModelId = GEMINI_FALLBACK_CHAIN[i];
    try {
      return await run(google(modelId));
    } catch (err) {
      lastErr = err;
      const isLastModel = i === GEMINI_FALLBACK_CHAIN.length - 1;
      if (isLastModel || !isRetryableAiError(err)) {
        throw err;
      }
      console.error(
        `[ai] ${modelId} failed with a retryable error, falling back to ${GEMINI_FALLBACK_CHAIN[i + 1]}:`,
        err
      );
    }
  }
  // Unreachable (the loop always returns or throws), but keeps TypeScript
  // happy about every code path returning T.
  throw lastErr;
}
