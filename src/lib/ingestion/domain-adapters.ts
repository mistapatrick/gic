import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  fetchWeatherBackfillChunk,
  writeWeatherBackfillChunk,
} from "@/lib/domains/weather/backfill";
import type { ClusterRow } from "@/lib/domains/weather/ingest-logic";

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

const ADAPTER_FACTORIES: Record<string, () => Promise<BackfillAdapter>> = {
  weather: getWeatherAdapter,
};

export const BACKFILL_DOMAINS = Object.keys(ADAPTER_FACTORIES);

export async function getBackfillAdapter(domain: string): Promise<BackfillAdapter | null> {
  const factory = ADAPTER_FACTORIES[domain];
  if (!factory) return null;
  return factory();
}
