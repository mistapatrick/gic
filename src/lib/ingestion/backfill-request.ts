import { z } from "zod";
import { BACKFILL_DOMAINS } from "@/lib/ingestion/domain-adapters";

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const StartBackfillSchema = z.object({
  domain: z.enum(BACKFILL_DOMAINS as [string, ...string[]]),
  rangeStart: DateString,
  rangeEnd: DateString,
  chunkSizeDays: z.number().int().min(1).max(31).optional().default(7),
});

export type StartBackfillInput = z.infer<typeof StartBackfillSchema>;

export interface ValidationResult {
  ok: boolean;
  data?: StartBackfillInput;
  error?: string;
}

/**
 * Pulled out as a pure function so the validation rules (date order, known
 * domain, chunk size bounds) are unit-testable without any Supabase or
 * network dependency — see tests/backfill-request.test.ts.
 */
export function validateStartBackfillInput(body: unknown): ValidationResult {
  const parsed = StartBackfillSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  if (parsed.data.rangeStart > parsed.data.rangeEnd) {
    return { ok: false, error: "rangeStart must be on or before rangeEnd" };
  }
  const today = new Date().toISOString().slice(0, 10);
  if (parsed.data.rangeEnd >= today) {
    return { ok: false, error: "rangeEnd must be in the past — backfill is for historical dates only" };
  }
  return { ok: true, data: parsed.data };
}
