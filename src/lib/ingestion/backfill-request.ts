import { z } from "zod";
import { BACKFILL_DOMAINS } from "@/lib/ingestion/domain-adapters";

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const StartBackfillSchema = z.object({
  domain: z.enum(BACKFILL_DOMAINS as [string, ...string[]]),
  rangeStart: DateString,
  rangeEnd: DateString,
  // Upper bound raised from 31 (Sub-phase 1, daily-granularity weather only)
  // to 3650 (~10 years) in Sub-phase 2: production_conditions is an
  // annual-granularity domain (FAOSTAT publishes once a year), and the
  // generic date-based backfill framework is reused unchanged for it via
  // an enumerateYears() helper that reads whatever date span a chunk
  // covers as "which calendar years does this span" — see
  // src/lib/domains/production-conditions/backfill.ts. A multi-decade
  // historical pull chunked at the old 31-day cap would mean one FAOSTAT
  // API call roughly every month of calendar-span instead of every ~decade,
  // which is both slower and needlessly chatty against a free public API.
  // Still an explicit bound (not unlimited) so a single chunk can't be
  // asked to cover an unbounded range in one request.
  chunkSizeDays: z.number().int().min(1).max(3650).optional().default(7),
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
