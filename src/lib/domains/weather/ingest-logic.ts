import { z } from "zod";
import type { ClusterMetrics, HourlyPoint, RiskFlag } from "@/lib/types";

/**
 * Pure, side-effect-free ingestion logic, factored out of the route handler
 * so it can be unit-tested directly (no live Supabase, no live Open-Meteo,
 * no Next.js request/response plumbing required) — see tests/ingest-logic.test.ts.
 */

export interface ClusterRow {
  id: number;
  slug: string;
  state_label: string;
  cluster_name: string;
  geo_zone: string;
  latitude: number;
  longitude: number;
}

// ----------------------------------------------------------------------------
// Date/time: Africa/Lagos is a fixed UTC+1 offset with no DST, year-round.
// Computing it as "UTC + 1 hour" and reading the UTC fields back off that is
// exact and avoids the classic `new Date(date.toLocaleString('en-US', {timeZone}))`
// pattern, which round-trips through a locale-formatted string and depends on
// the JS engine's date parser understanding that exact format.
// ----------------------------------------------------------------------------
export function getLagosDateParts(nowUtc: Date = new Date()): {
  obsDate: string;
  currentHour: number;
} {
  const lagos = new Date(nowUtc.getTime() + 60 * 60 * 1000);
  const yyyy = lagos.getUTCFullYear();
  const mm = String(lagos.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(lagos.getUTCDate()).padStart(2, "0");
  return {
    obsDate: `${yyyy}-${mm}-${dd}`,
    currentHour: lagos.getUTCHours(),
  };
}

/**
 * Never ingest an hour that hasn't elapsed yet. Caps at 23:00 WAT (hour 23) —
 * the full day — now that the nightly run fires at 23:59 WAT. The clamp is
 * still worth keeping (rather than trusting the caller) because a manual
 * `workflow_dispatch` backfill run can fire at any hour of the day, when
 * `currentHour` is well under 23.
 */
export function getCutoffHour(currentHour: number): number {
  return Math.max(0, Math.min(currentHour, 23));
}

export function buildOpenMeteoUrl(clusters: ClusterRow[]): string {
  const lats = clusters.map((c) => c.latitude).join(",");
  const lons = clusters.map((c) => c.longitude).join(",");
  // forecast_days=1 is required to get TODAY's date in the response at all —
  // forecast_days counts from today forward, so forecast_days=0 returns zero
  // days starting from today (confirmed against Open-Meteo: with past_days=1
  // &forecast_days=0 the hourly.time array contains only yesterday's 24 hours,
  // never today's). The "never ingest an hour that hasn't elapsed yet"
  // guarantee does NOT come from forecast_days — it comes from the
  // `hour > cutoffHour` filter in parseIngestionResults, which already
  // discards every not-yet-elapsed hour of today regardless of how many
  // forecast hours the API hands back. past_days=1 is kept as a one-day
  // backfill margin (covers a run that's late or re-run the next morning).
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
    `&hourly=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,sunshine_duration` +
    `&timezone=Africa%2FLagos&past_days=1&forecast_days=1`
  );
}

// Defensive parsing of the upstream API response: Open-Meteo is a third
// party, so its payload is untrusted input and is validated before any of
// its values are indexed into or written to the database.
export const OpenMeteoLocationSchema = z.object({
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(z.number().nullable()),
    relative_humidity_2m: z.array(z.number().nullable()),
    precipitation: z.array(z.number().nullable()),
    wind_speed_10m: z.array(z.number().nullable()),
    sunshine_duration: z.array(z.number().nullable()).optional(),
  }),
});

export const OpenMeteoResponseSchema = z.union([
  z.array(OpenMeteoLocationSchema),
  OpenMeteoLocationSchema.transform((loc) => [loc]),
]);

export type OpenMeteoLocation = z.infer<typeof OpenMeteoLocationSchema>;

export interface ParsedIngestion {
  hourlyRows: Array<{
    cluster_id: number;
    obs_date: string;
    obs_hour: number;
    temp_2m_c: number;
    rel_humidity_pct: number;
    precip_mm: number;
    wind_speed_kmh: number;
    sunshine_hrs: number;
  }>;
  clusterMetrics: ClusterMetrics[];
}

const round = (n: number, dp: number) => Number(n.toFixed(dp));
/** Clamp to a sane non-negative reading — guards against upstream sensor noise
 *  (e.g. a tiny negative float) tripping the database's `>= 0` CHECK constraints. */
const nonNegative = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function parseIngestionResults(
  resultsArray: OpenMeteoLocation[],
  clusters: ClusterRow[],
  obsDate: string,
  cutoffHour: number
): ParsedIngestion {
  const hourlyRows: ParsedIngestion["hourlyRows"] = [];
  const clusterMetrics: ClusterMetrics[] = [];

  resultsArray.forEach((locData, idx) => {
    const cluster = clusters[idx];
    if (!cluster) return; // defensive: array-length mismatch between clusters and API response

    const times = locData.hourly.time;
    const series: HourlyPoint[] = [];

    let cumRain = 0;
    let cumSunHrs = 0;
    let tempSum = 0;
    let runMax = -Infinity;
    let runMin = Infinity;

    times.forEach((t, hIdx) => {
      if (!t.startsWith(obsDate)) return;
      const hour = parseInt(t.slice(11, 13), 10);
      if (!Number.isFinite(hour) || hour > cutoffHour) return; // never ingest unelapsed hours

      const temp = round(locData.hourly.temperature_2m[hIdx] ?? 0, 1);
      const rh = Math.min(100, Math.max(0, round(locData.hourly.relative_humidity_2m[hIdx] ?? 0, 0)));
      const rain = round(nonNegative(locData.hourly.precipitation[hIdx] ?? 0), 2);
      const wind = round(nonNegative(locData.hourly.wind_speed_10m[hIdx] ?? 0), 1);
      const sunSec = locData.hourly.sunshine_duration?.[hIdx] ?? 0;
      const sunHrs = Math.min(1, round(nonNegative(sunSec) / 3600, 2));

      cumRain = round(cumRain + rain, 2);
      cumSunHrs = round(cumSunHrs + sunHrs, 2);
      tempSum += temp;
      runMax = Math.max(runMax, temp);
      runMin = Math.min(runMin, temp);
      const runAvg = round(tempSum / (series.length + 1), 1);

      hourlyRows.push({
        cluster_id: cluster.id,
        obs_date: obsDate,
        obs_hour: hour,
        temp_2m_c: temp,
        rel_humidity_pct: rh,
        precip_mm: rain,
        wind_speed_kmh: wind,
        sunshine_hrs: sunHrs,
      });

      series.push({
        obs_hour: hour,
        label: `${String(hour).padStart(2, "0")}:00`,
        precip_mm: rain,
        cum_precip_mm: cumRain,
        rel_humidity_pct: rh,
        wind_speed_kmh: wind,
        temp_2m_c: temp,
        avg_temp_c: runAvg,
        max_temp_c: runMax,
        min_temp_c: runMin,
        sunshine_hrs: sunHrs,
        cum_sunshine_hrs: cumSunHrs,
      });
    });

    const finalStep = series[series.length - 1];
    const avgWind = series.reduce((acc, s) => acc + s.wind_speed_kmh, 0) / (series.length || 1);
    const avgHumidity = series.reduce((acc, s) => acc + s.rel_humidity_pct, 0) / (series.length || 1);

    const totals = {
      total_precip_mm: round(finalStep?.cum_precip_mm ?? 0, 1),
      avg_humidity_pct: round(avgHumidity, 0),
      avg_wind_kmh: round(avgWind, 1),
      avg_temp_c: finalStep?.avg_temp_c ?? 0,
      max_temp_c: finalStep?.max_temp_c === -Infinity ? 0 : finalStep?.max_temp_c ?? 0,
      min_temp_c: finalStep?.min_temp_c === Infinity ? 0 : finalStep?.min_temp_c ?? 0,
      total_sunshine_hrs: round(finalStep?.cum_sunshine_hrs ?? 0, 1),
    };

    clusterMetrics.push({
      cluster_id: cluster.id,
      slug: cluster.slug,
      state_label: cluster.state_label,
      cluster_name: cluster.cluster_name,
      geo_zone: cluster.geo_zone as ClusterMetrics["geo_zone"],
      latitude: cluster.latitude,
      longitude: cluster.longitude,
      ...totals,
      hourly: series,
      risk_flags: computeRiskFlags(totals),
    });
  });

  return { hourlyRows, clusterMetrics };
}

// ----------------------------------------------------------------------------
// Deterministic agronomic risk flags.
//
// These are plain threshold rules over a single night's own observed totals
// for one cluster — computed in code, not by the AI brief, so a flag quoted
// in a client briefing, a funder report, or a bid is exact and reproducible
// rather than a plausible-sounding sentence. They are a first-pass,
// generically-applicable heuristic model (not calibrated to any one crop or
// validated against agronomic field data), and they only ever look at a
// single elapsed day — a genuine multi-day streak detector (e.g. "3
// consecutive high-humidity/low-sunshine days") needs several nights of
// accumulated history and is a natural next iteration once the dataset has
// that depth. Thresholds are named constants specifically so Growthly's own
// agronomic input can recalibrate them per cluster/crop without touching the
// rule structure.
// ----------------------------------------------------------------------------
const RISK_THRESHOLDS = {
  rainfallAlertMm: 50,
  rainfallWatchMm: 25,
  dryingAlertHumidityPct: 80,
  dryingAlertMaxSunHrs: 3,
  dryingWatchHumidityPct: 70,
  dryingWatchMaxSunHrs: 4,
  heatAlertC: 42,
  heatWatchC: 38,
  windWatchKmh: 45,
  windInfoKmh: 30,
} as const;

export function computeRiskFlags(m: {
  total_precip_mm: number;
  avg_humidity_pct: number;
  total_sunshine_hrs: number;
  max_temp_c: number;
  avg_wind_kmh: number;
}): RiskFlag[] {
  const flags: RiskFlag[] = [];

  // Rainfall: flood / feeder-road waterlogging risk for haulage and logistics.
  if (m.total_precip_mm >= RISK_THRESHOLDS.rainfallAlertMm) {
    flags.push({
      code: "heavy_rainfall",
      label: "Heavy rainfall observed",
      severity: "alert",
      detail: `${m.total_precip_mm} mm observed today — above ${RISK_THRESHOLDS.rainfallAlertMm} mm/day, typically associated with localized flooding and feeder-road waterlogging.`,
    });
  } else if (m.total_precip_mm >= RISK_THRESHOLDS.rainfallWatchMm) {
    flags.push({
      code: "heavy_rainfall",
      label: "Elevated rainfall observed",
      severity: "watch",
      detail: `${m.total_precip_mm} mm observed today — above the ${RISK_THRESHOLDS.rainfallWatchMm} mm/day watch threshold.`,
    });
  } else if (m.total_precip_mm === 0) {
    flags.push({
      code: "no_rainfall",
      label: "No rainfall observed",
      severity: "info",
      detail: "Zero rainfall observed today. A single dry day is unremarkable on its own — treat as informational until a multi-day streak is tracked.",
    });
  }

  // Humidity + sunshine: post-harvest drying / spoilage / aflatoxin risk —
  // the exact pattern the product-fit critique named as the real moat.
  if (
    m.avg_humidity_pct >= RISK_THRESHOLDS.dryingAlertHumidityPct &&
    m.total_sunshine_hrs < RISK_THRESHOLDS.dryingAlertMaxSunHrs
  ) {
    flags.push({
      code: "drying_risk",
      label: "Drying & post-harvest spoilage risk",
      severity: "alert",
      detail: `${m.avg_humidity_pct}% average humidity with only ${m.total_sunshine_hrs} sunshine hrs today — poor grain/crop drying conditions, elevated spoilage and aflatoxin risk.`,
    });
  } else if (
    m.avg_humidity_pct >= RISK_THRESHOLDS.dryingWatchHumidityPct &&
    m.total_sunshine_hrs < RISK_THRESHOLDS.dryingWatchMaxSunHrs
  ) {
    flags.push({
      code: "drying_risk",
      label: "Limited drying conditions",
      severity: "watch",
      detail: `${m.avg_humidity_pct}% average humidity with ${m.total_sunshine_hrs} sunshine hrs today — below-average drying conditions.`,
    });
  }

  // Heat stress on crops, livestock, and outdoor labor.
  if (m.max_temp_c >= RISK_THRESHOLDS.heatAlertC) {
    flags.push({
      code: "heat_stress",
      label: "Severe heat observed",
      severity: "alert",
      detail: `${m.max_temp_c}°C peak observed today — at or above ${RISK_THRESHOLDS.heatAlertC}°C, a severe heat-stress threshold for most staple crops and livestock.`,
    });
  } else if (m.max_temp_c >= RISK_THRESHOLDS.heatWatchC) {
    flags.push({
      code: "heat_stress",
      label: "High daytime heat observed",
      severity: "watch",
      detail: `${m.max_temp_c}°C peak observed today — above the ${RISK_THRESHOLDS.heatWatchC}°C watch threshold.`,
    });
  }

  // Wind: dust, transpiration stress, and light-structure/logistics risk.
  if (m.avg_wind_kmh >= RISK_THRESHOLDS.windWatchKmh) {
    flags.push({
      code: "high_wind",
      label: "Elevated wind speeds observed",
      severity: "watch",
      detail: `${m.avg_wind_kmh} km/h average wind today — above ${RISK_THRESHOLDS.windWatchKmh} km/h, a risk threshold for light structures and open-air drying/storage.`,
    });
  } else if (m.avg_wind_kmh >= RISK_THRESHOLDS.windInfoKmh) {
    flags.push({
      code: "high_wind",
      label: "Breezy conditions observed",
      severity: "info",
      detail: `${m.avg_wind_kmh} km/h average wind today — above ${RISK_THRESHOLDS.windInfoKmh} km/h.`,
    });
  }

  return flags;
}

export function buildCompactTelemetry(clusterMetrics: ClusterMetrics[]) {
  return clusterMetrics.map((m) => ({
    zone: m.geo_zone,
    location: `${m.state_label} (${m.cluster_name})`,
    rainMm: m.total_precip_mm,
    rhPct: m.avg_humidity_pct,
    windKmh: m.avg_wind_kmh,
    avgC: m.avg_temp_c,
    maxC: m.max_temp_c,
    minC: m.min_temp_c,
    sunHrs: m.total_sunshine_hrs,
    flags: m.risk_flags.map((f) => f.label),
  }));
}

export function buildAiPrompt(
  obsDate: string,
  cutoffHour: number,
  compactTelemetry: ReturnType<typeof buildCompactTelemetry>
): string {
  return [
    `Analyze ONLY the following experienced/observed weather telemetry for ${obsDate}`,
    `(00:00 to ${String(cutoffHour).padStart(2, "0")}:00 WAT) across all 24 Nigerian`,
    `agricultural clusters. This is observational data already measured — it is NOT a`,
    `forecast, and you must not speculate about future conditions. Ground every claim`,
    `strictly in the numbers given below; do not invent locations, dates, or figures`,
    `that are not present in this telemetry.`,
    "",
    `Each cluster's "flags" array was computed deterministically by fixed threshold`,
    `rules, not by you — treat it as ground truth. Your agronomic_implication for a`,
    `cluster must be consistent with its flags (explain/contextualize them in plain`,
    `language) and must never assert an agronomic risk that isn't backed by a flag or`,
    `a plainly-stated number in the telemetry itself.`,
    "",
    "Telemetry (JSON):",
    JSON.stringify(compactTelemetry),
  ].join("\n");
}
