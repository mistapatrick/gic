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
import { GIC_OUTBOUND_HEADERS } from "@/lib/ingestion/outbound-headers";

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
  // 45s, not the original 20s: the live cron route (src/app/api/ingest/
  // production-conditions/route.ts) hit this exact same undersized timeout
  // against this exact same FAOSTAT endpoint and needed 45s to clear it —
  // this file is a separate code path (the backfill adapter, not the live
  // route) that was never touched by that fix, so it still had the
  // original bug. A backfill chunk can also span more years in one request
  // than the live route's "last 3 years" ever does, so if anything this
  // call needs more headroom than that one did, not less.
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
    headers: GIC_OUTBOUND_HEADERS,
  });
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
 *
 * Shared across every write path into this table — the live-query JSON
 * path below, and the independent bulk-CSV path in bulk-backfill.ts and
 * the super-admin manual upload route — so there is exactly one place
 * that knows this table's conflict target. None of those other callers
 * know or care how their rows were parsed; they just need them written
 * the same, idempotent way.
 */
export async function upsertProductionConditionRows(rows: ProductionConditionRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const admin = getSupabaseAdminClient();
  const { error } = await admin
    .from("production_conditions")
    .upsert(rows, { onConflict: "commodity,metric,year,region" });
  if (error) throw new Error(`production_conditions upsert failed: ${error.message}`);

  return rows.length;
}

export async function writeProductionConditionsBackfillChunk(data: unknown): Promise<number> {
  const rows = parseProductionConditionsBackfillChunk(data);
  return upsertProductionConditionRows(rows);
}
