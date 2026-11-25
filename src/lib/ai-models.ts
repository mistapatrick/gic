import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
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
export const GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"] as const;

/**
 * Groq fallback, added 2026-11-25 to close a gap between this file and
 * `claude/gic-phase-1-synopsis.md`, which had described the architecture as
 * "Gemini (two models) plus Groq as a third, vendor-independent fallback"
 * since Sub-phase 1 while this file only ever implemented the two Gemini
 * legs — Groq was reserved in `.env.example`/README but nothing called it.
 * This is that third leg, now real.
 *
 * `openai/gpt-oss-120b` was chosen over `openai/gpt-oss-20b` because Groq's
 * published free-tier limits give both the same daily request quota (1,000
 * RPD as of this writing — already more generous than Gemini Flash-Lite's
 * ~500/day), so there's no quota reason to prefer the smaller model, and
 * gpt-oss-120b is the larger, higher-quality model of the pair.
 *
 * Caveat, same discipline as the FAOSTAT area-code and NBS/World-Bank-RTFP
 * catalog precautions elsewhere in this codebase: Groq deprecates and
 * decommissions hosted models on a rolling basis (see
 * console.groq.com/docs/deprecations) and this ID could not be test-called
 * from this build's sandbox (no live GROQ_API_KEY, no outbound access to
 * groq.com). Confirm `openai/gpt-oss-120b` is still listed as a production
 * model at console.groq.com/docs/models on or before first deployment; if
 * it's gone, swap GROQ_MODEL below for whatever replaced it.
 *
 * Requires `GROQ_API_KEY` (free, from console.groq.com) — the default
 * `groq` provider instance imported below reads it from the environment
 * automatically, the same way `google` reads `GOOGLE_GENERATIVE_AI_API_KEY`.
 * See `.env.example`.
 */
export const GROQ_MODEL = "openai/gpt-oss-120b";

type ChainEntry =
  | { provider: "gemini"; modelId: (typeof GEMINI_MODELS)[number] }
  | { provider: "groq"; modelId: typeof GROQ_MODEL };

/**
 * The full three-leg fallback chain, in attempt order: both Gemini models,
 * then Groq last. Exported (rather than kept private) so tests can assert
 * against its shape directly instead of only against end-to-end behavior.
 */
export const AI_FALLBACK_CHAIN: readonly ChainEntry[] = [
  ...GEMINI_MODELS.map((modelId) => ({ provider: "gemini", modelId }) as const),
  { provider: "groq", modelId: GROQ_MODEL } as const,
];

function buildModel(entry: ChainEntry) {
  return entry.provider === "gemini" ? google(entry.modelId) : groq(entry.modelId);
}

/**
 * Whether it's worth retrying this error against the *next* entry in the
 * chain. A transient server-side condition (503 high demand, 500, 429 quota
 * — quota is tracked per model/provider, so the next entry has its own
 * budget, any 5xx, a request timeout) is worth a second attempt elsewhere. A
 * client error (bad API key, invalid request shape) will fail identically on
 * every entry in the chain, so don't waste the fallback attempt on those —
 * surface it immediately instead. This logic is provider-agnostic: both
 * `@ai-sdk/google` and `@ai-sdk/groq` throw the AI SDK's shared
 * `APICallError`/`RetryError` types rather than provider-specific ones.
 */
function isRetryableAiError(err: unknown): boolean {
  if (RetryError.isInstance(err)) {
    return isRetryableAiError(err.lastError);
  }
  if (APICallError.isInstance(err)) {
    return err.isRetryable || err.statusCode === 429;
  }
  // Fetch/AbortSignal timeouts surface as a plain Error named "TimeoutError",
  // not an APICallError — still worth trying the next entry for.
  return err instanceof Error && err.name === "TimeoutError";
}

/**
 * Runs `run` against each entry in AI_FALLBACK_CHAIN in order (Gemini 3.5
 * Flash-Lite, then Gemini 3.1 Flash-Lite, then Groq's gpt-oss-120b), moving
 * to the next one only on a retryable failure. Returns the first success, or
 * re-throws the last error once the chain is exhausted (or immediately, for
 * a non-retryable error).
 */
export async function withAiFallback<T>(
  run: (model: ReturnType<typeof google> | ReturnType<typeof groq>) => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < AI_FALLBACK_CHAIN.length; i++) {
    const entry = AI_FALLBACK_CHAIN[i];
    try {
      return await run(buildModel(entry));
    } catch (err) {
      lastErr = err;
      const isLastModel = i === AI_FALLBACK_CHAIN.length - 1;
      if (isLastModel || !isRetryableAiError(err)) {
        throw err;
      }
      const next = AI_FALLBACK_CHAIN[i + 1];
      console.error(
        `[ai] ${entry.provider}:${entry.modelId} failed with a retryable error, falling back to ${next.provider}:${next.modelId}:`,
        err
      );
    }
  }
  // Unreachable (the loop always returns or throws), but keeps TypeScript
  // happy about every code path returning T.
  throw lastErr;
}
