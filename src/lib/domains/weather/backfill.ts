import "server-only";
import {
  OpenMeteoResponseSchema,
  parseIngestionResults,
  type ClusterRow,
  type OpenMeteoLocation,
} from "@/lib/domains/weather/ingest-logic";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Weather domain's plug-in for the generic backfill framework
 * (src/lib/ingestion/backfill-framework.ts). Reuses parseIngestionResults
 * from the live steady-state ingest path unchanged — the per-day parsing,
 * rounding, and deterministic risk-flag logic is exactly the already-tested
 * code in ingest-logic.ts, called once per date in the chunk, rather than a
 * re-derived copy.
 *
 * Deliberately does NOT call the Gemini AI brief for backfilled dates: a
 * multi-year historical pull could mean hundreds of AI calls just to fill
 * in narrative text nobody asked for, against a free-tier daily quota the
 * steady-state nightly job also depends on. Each backfilled day instead
 * gets cluster_metrics (real, computed) and a plain placeholder
 * national_summary explaining why. If an AI-authored report already exists
 * for a date (i.e. it was already live-ingested), the backfill write step
 * never overwrites it — see writeWeatherBackfillChunk's `ignoreDuplicates`.
 */

export function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function buildArchiveUrl(
  clusters: ClusterRow[],
  startDate: string,
  endDate: string
): string {
  const lats = clusters.map((c) => c.latitude).join(",");
  const lons = clusters.map((c) => c.longitude).join(",");
  // archive-api.open-meteo.com is Open-Meteo's historical endpoint — distinct
  // from api.open-meteo.com/v1/forecast (used for steady-state ingestion),
  // which only exposes a short rolling window of past days. Same free tier,
  // same hourly variable names, so parseIngestionResults needs no changes.
  return (
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,sunshine_duration` +
    `&timezone=Africa%2FLagos`
  );
}

export async function fetchWeatherBackfillChunk(
  clusters: ClusterRow[],
  startDate: string,
  endDate: string
): Promise<OpenMeteoLocation[]> {
  const url = buildArchiveUrl(clusters, startDate, endDate);
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`Open-Meteo archive request failed: HTTP ${res.status}`);
  }
  const raw: unknown = await res.json();
  const parsed = OpenMeteoResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Open-Meteo archive response failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export interface ParsedBackfillChunk {
  hourlyRows: ReturnType<typeof parseIngestionResults>["hourlyRows"];
  dailyReports: Array<{
    obs_date: string;
    cutoff_hour_wat: number;
    national_summary: string;
    regional_insights: unknown[];
    cluster_metrics: ReturnType<typeof parseIngestionResults>["clusterMetrics"];
  }>;
}

const BACKFILL_PLACEHOLDER_SUMMARY =
  "Backfilled historical telemetry. This date was ingested ahead of GIC's launch, " +
  "before any personnel were reviewing live data, so no AI synthesis was generated " +
  "for it — the cluster metrics and risk flags below are computed directly from the " +
  "observed readings and are fully reliable; only the narrative national summary is skipped.";

export function parseWeatherBackfillChunk(
  omData: OpenMeteoLocation[],
  clusters: ClusterRow[],
  chunkStart: string,
  chunkEnd: string
): ParsedBackfillChunk {
  const hourlyRows: ParsedBackfillChunk["hourlyRows"] = [];
  const dailyReports: ParsedBackfillChunk["dailyReports"] = [];

  for (const obsDate of enumerateDates(chunkStart, chunkEnd)) {
    // cutoffHour=23: every date in a historical range is, by definition,
    // fully elapsed — there is no "don't ingest the future" concern here
    // the way there is for the steady-state nightly job.
    const { hourlyRows: dayRows, clusterMetrics } = parseIngestionResults(
      omData,
      clusters,
      obsDate,
      23
    );
    if (dayRows.length === 0) continue; // e.g. a date outside what the archive returned

    hourlyRows.push(...dayRows);
    dailyReports.push({
      obs_date: obsDate,
      cutoff_hour_wat: 23,
      national_summary: BACKFILL_PLACEHOLDER_SUMMARY,
      regional_insights: [],
      cluster_metrics: clusterMetrics,
    });
  }

  return { hourlyRows, dailyReports };
}

/**
 * Writes one parsed chunk. Same idempotent-upsert pattern as the
 * steady-state /api/ingest route for observed_hourly (safe to overwrite —
 * raw readings should always reflect the latest fetch). daily_observed_reports
 * uses `ignoreDuplicates: true` instead: never clobber an already-live,
 * AI-authored report with the backfill's placeholder summary.
 */
export async function writeWeatherBackfillChunk(
  data: unknown,
  clusters: ClusterRow[],
  chunkStart: string,
  chunkEnd: string
): Promise<number> {
  const parsed = parseWeatherBackfillChunk(data as OpenMeteoLocation[], clusters, chunkStart, chunkEnd);
  if (parsed.hourlyRows.length === 0) return 0;

  const admin = getSupabaseAdminClient();

  const { error: hourlyErr } = await admin
    .from("observed_hourly")
    .upsert(parsed.hourlyRows, { onConflict: "cluster_id,obs_date,obs_hour" });
  if (hourlyErr) throw new Error(`observed_hourly upsert failed: ${hourlyErr.message}`);

  const { error: reportErr } = await admin
    .from("daily_observed_reports")
    .upsert(parsed.dailyReports, { onConflict: "obs_date", ignoreDuplicates: true });
  if (reportErr) throw new Error(`daily_observed_reports upsert failed: ${reportErr.message}`);

  return parsed.hourlyRows.length;
}
