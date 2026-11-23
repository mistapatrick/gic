import "server-only";
import {
  buildFaostatUrl,
  enumerateYears,
  parseFaostatRecords,
  FaostatResponseSchema,
  FAOSTAT_AREA_CODE_NIGERIA,
  type ProductionConditionRow,
} from "@/lib/domains/production-conditions/ingest-logic";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * production_conditions domain's plug-in for the generic backfill
 * framework (src/lib/ingestion/backfill-framework.ts) — the direct
 * parallel of src/lib/domains/weather/backfill.ts.
 *
 * The one structural difference from weather: FAOSTAT is annual, not
 * daily, so a "chunk" here is a calendar-year span rather than a day
 * span. The generic framework still only understands dates — this file is
 * what reinterprets the date span it hands down as "which years" via
 * enumerateYears(), so backfill-framework.ts itself needed no changes.
 */

export async function fetchProductionConditionsBackfillChunk(
  chunkStart: string,
  chunkEnd: string
): Promise<unknown> {
  const years = enumerateYears(chunkStart, chunkEnd);
  const url = buildFaostatUrl(FAOSTAT_AREA_CODE_NIGERIA, years);
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`FAOSTAT request failed: HTTP ${res.status}`);
  }
  const raw: unknown = await res.json();
  const parsed = FaostatResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`FAOSTAT response failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function parseProductionConditionsBackfillChunk(data: unknown): ProductionConditionRow[] {
  return parseFaostatRecords(data, FAOSTAT_AREA_CODE_NIGERIA);
}

/**
 * Idempotent upsert, same pattern as production_conditions' unique
 * (commodity, metric, year, region) constraint is designed for: re-running
 * a backfill chunk that overlaps an already-ingested year overwrites the
 * same rows rather than erroring or duplicating.
 */
export async function writeProductionConditionsBackfillChunk(data: unknown): Promise<number> {
  const rows = parseProductionConditionsBackfillChunk(data);
  if (rows.length === 0) return 0;

  const admin = getSupabaseAdminClient();
  const { error } = await admin
    .from("production_conditions")
    .upsert(rows, { onConflict: "commodity,metric,year,region" });
  if (error) throw new Error(`production_conditions upsert failed: ${error.message}`);

  return rows.length;
}
