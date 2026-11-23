import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  fetchWeatherBackfillChunk,
  writeWeatherBackfillChunk,
} from "@/lib/domains/weather/backfill";
import type { ClusterRow } from "@/lib/domains/weather/ingest-logic";
import {
  fetchProductionConditionsBackfillChunk,
  writeProductionConditionsBackfillChunk,
} from "@/lib/domains/production-conditions/backfill";
import {
  fetchNbsBackfillChunk,
  writeNbsBackfillChunk,
} from "@/lib/domains/commodity-prices/nbs-backfill";
import {
  fetchWorldBankRtfpBackfillChunk,
  writeWorldBankRtfpBackfillChunk,
} from "@/lib/domains/commodity-prices/worldbank-rtfp-backfill";

/**
 * One entry per data domain that supports historical backfill. This is the
 * single place a later sub-phase registers a new domain's backfill
 * adapter — src/app/api/admin/backfill/route.ts and the generic runner in
 * backfill-framework.ts never change when a domain is added here, which is
 * the "plug-and-play, modular" requirement applied to backfill
 * specifically: a broken or not-yet-built domain adapter simply isn't in
 * this map, and every other domain's backfill is unaffected.
 */
export interface BackfillAdapter {
  fetchChunk: (start: string, end: string) => Promise<unknown>;
  writeChunk: (data: unknown, start: string, end: string) => Promise<number>;
}

async function getWeatherAdapter(): Promise<BackfillAdapter> {
  const admin = getSupabaseAdminClient();
  const { data: clusters, error } = await admin
    .from("weather_clusters")
    .select("*")
    .order("id", { ascending: true });

  if (error || !clusters || clusters.length === 0) {
    throw new Error("Could not load weather_clusters for backfill");
  }
  const typedClusters = clusters as ClusterRow[];

  return {
    fetchChunk: (start, end) => fetchWeatherBackfillChunk(typedClusters, start, end),
    writeChunk: (data, start, end) => writeWeatherBackfillChunk(data, typedClusters, start, end),
  };
}

// No Supabase lookup needed up front (unlike weather, which needs the
// cluster list before it can even build a request URL) — FAOSTAT's request
// shape only depends on the chunk's own date span, which the generic
// framework already passes to fetchChunk/writeChunk.
async function getProductionConditionsAdapter(): Promise<BackfillAdapter> {
  return {
    fetchChunk: (start, end) => fetchProductionConditionsBackfillChunk(start, end),
    writeChunk: (data) => writeProductionConditionsBackfillChunk(data),
  };
}

// NBS publishes one file per month rather than a queryable date-range API
// — fetchChunk reinterprets the chunk's date span as "which months,"
// matching production_conditions' enumerateYears() reinterpretation at a
// finer (monthly, not annual) grain. See nbs-backfill.ts.
async function getCommodityPricesNbsAdapter(): Promise<BackfillAdapter> {
  return {
    fetchChunk: (start, end) => fetchNbsBackfillChunk(start, end),
    writeChunk: (data) => writeNbsBackfillChunk(data as Parameters<typeof writeNbsBackfillChunk>[0]),
  };
}

// World Bank RTFP publishes Nigeria's entire 2007-to-present history as
// one CSV, re-released under a new dated filename roughly weekly — there
// is no narrower request to make, so fetchChunk ignores the chunk's date
// span entirely and always pulls the one current file. See
// worldbank-rtfp-backfill.ts.
async function getCommodityPricesWorldBankRtfpAdapter(): Promise<BackfillAdapter> {
  return {
    fetchChunk: () => fetchWorldBankRtfpBackfillChunk(),
    writeChunk: (data) => writeWorldBankRtfpBackfillChunk(data as string),
  };
}

const ADAPTER_FACTORIES: Record<string, () => Promise<BackfillAdapter>> = {
  weather: getWeatherAdapter,
  production_conditions: getProductionConditionsAdapter,
  commodity_prices_nbs: getCommodityPricesNbsAdapter,
  commodity_prices_worldbank_rtfp: getCommodityPricesWorldBankRtfpAdapter,
};

export const BACKFILL_DOMAINS = Object.keys(ADAPTER_FACTORIES);

export async function getBackfillAdapter(domain: string): Promise<BackfillAdapter | null> {
  const factory = ADAPTER_FACTORIES[domain];
  if (!factory) return null;
  return factory();
}
