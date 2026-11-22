import { z } from "zod";
import type { ClusterMetrics } from "@/lib/types";

/**
 * Pure, side-effect-free CSV/XLSX export logic, factored out of the route
 * handler so it can be unit-tested directly — see tests/export-logic.test.ts.
 * Mirrors the project's existing pattern (ingest-logic.ts, chat-logic.ts).
 */

// ----------------------------------------------------------------------------
// Request validation
// ----------------------------------------------------------------------------
export const ExportQuerySchema = z.object({
  type: z.enum(["hourly", "daily"]),
  format: z.enum(["csv", "xlsx"]),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "start must be YYYY-MM-DD"),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "end must be YYYY-MM-DD"),
});
export type ExportQuery = z.infer<typeof ExportQuerySchema>;

// Bounds on the requested range, so a single export request can't try to pull
// years of hourly data into one serverless invocation. Hourly is the much
// denser dataset (24 clusters x 24 rows/day), so it gets a tighter cap than
// the already-aggregated daily summaries.
export const MAX_HOURLY_RANGE_DAYS = 92; // ~3 months
export const MAX_DAILY_RANGE_DAYS = 366; // ~1 year

export interface DateRangeValidation {
  ok: boolean;
  error?: string;
  rangeDays?: number;
}

/**
 * Validates start/end as real calendar dates (not just YYYY-MM-DD-shaped
 * strings) and bounds the range. `new Date("2026-02-30T00:00:00Z")` does NOT
 * throw or produce an Invalid Date — JS silently rolls it forward to
 * 2026-03-02, so a naive `Number.isNaN(date.getTime())` check alone misses
 * an invalid calendar date entirely. Round-tripping back through
 * toISOString() and comparing to the original string catches that rollover.
 */
export function validateDateRange(
  start: string,
  end: string,
  type: ExportQuery["type"]
): DateRangeValidation {
  const startDate = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || startDate.toISOString().slice(0, 10) !== start) {
    return { ok: false, error: "start must be a valid calendar date (YYYY-MM-DD)" };
  }

  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(endDate.getTime()) || endDate.toISOString().slice(0, 10) !== end) {
    return { ok: false, error: "end must be a valid calendar date (YYYY-MM-DD)" };
  }

  if (startDate.getTime() > endDate.getTime()) {
    return { ok: false, error: "start must be on or before end" };
  }

  const rangeDays = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
  const maxDays = type === "hourly" ? MAX_HOURLY_RANGE_DAYS : MAX_DAILY_RANGE_DAYS;
  if (rangeDays > maxDays) {
    return {
      ok: false,
      error: `Date range too large for a ${type} export — max ${maxDays} days, requested ${rangeDays}`,
    };
  }

  return { ok: true, rangeDays };
}

// ----------------------------------------------------------------------------
// Row shapes + column definitions (shared by the CSV and XLSX writers so the
// two formats never drift apart in column order/naming)
// ----------------------------------------------------------------------------
export interface HourlyExportRow {
  obs_date: string;
  obs_hour: number;
  state_label: string;
  cluster_name: string;
  geo_zone: string;
  latitude: number;
  longitude: number;
  temp_2m_c: number;
  rel_humidity_pct: number;
  precip_mm: number;
  wind_speed_kmh: number;
  sunshine_hrs: number;
}

export interface DailyExportRow {
  obs_date: string;
  cutoff_hour_wat: number;
  state_label: string;
  cluster_name: string;
  geo_zone: string;
  latitude: number;
  longitude: number;
  total_precip_mm: number;
  avg_humidity_pct: number;
  avg_wind_kmh: number;
  avg_temp_c: number;
  max_temp_c: number;
  min_temp_c: number;
  total_sunshine_hrs: number;
  risk_flags: string;
}

export interface ExportColumn<T> {
  key: keyof T;
  header: string;
}

export const HOURLY_COLUMNS: ExportColumn<HourlyExportRow>[] = [
  { key: "obs_date", header: "Date" },
  { key: "obs_hour", header: "Hour (WAT)" },
  { key: "state_label", header: "State" },
  { key: "cluster_name", header: "Cluster" },
  { key: "geo_zone", header: "Geo Zone" },
  { key: "latitude", header: "Latitude" },
  { key: "longitude", header: "Longitude" },
  { key: "temp_2m_c", header: "Temp (C)" },
  { key: "rel_humidity_pct", header: "Humidity (%)" },
  { key: "precip_mm", header: "Rainfall (mm)" },
  { key: "wind_speed_kmh", header: "Wind Speed (km/h)" },
  { key: "sunshine_hrs", header: "Sunshine (hrs)" },
];

export const DAILY_COLUMNS: ExportColumn<DailyExportRow>[] = [
  { key: "obs_date", header: "Date" },
  { key: "cutoff_hour_wat", header: "Hours Captured (0-N WAT)" },
  { key: "state_label", header: "State" },
  { key: "cluster_name", header: "Cluster" },
  { key: "geo_zone", header: "Geo Zone" },
  { key: "latitude", header: "Latitude" },
  { key: "longitude", header: "Longitude" },
  { key: "total_precip_mm", header: "Total Rainfall (mm)" },
  { key: "avg_humidity_pct", header: "Avg Humidity (%)" },
  { key: "avg_wind_kmh", header: "Avg Wind Speed (km/h)" },
  { key: "avg_temp_c", header: "Avg Temp (C)" },
  { key: "max_temp_c", header: "Max Temp (C)" },
  { key: "min_temp_c", header: "Min Temp (C)" },
  { key: "total_sunshine_hrs", header: "Total Sunshine (hrs)" },
  { key: "risk_flags", header: "Risk Flags" },
];

// ----------------------------------------------------------------------------
// Row shaping: DB rows -> flat export rows
// ----------------------------------------------------------------------------
export interface ClusterLookupRow {
  id: number;
  state_label: string;
  cluster_name: string;
  geo_zone: string;
  latitude: number;
  longitude: number;
}

export interface ObservedHourlyDbRow {
  cluster_id: number;
  obs_date: string;
  obs_hour: number;
  temp_2m_c: number;
  rel_humidity_pct: number;
  precip_mm: number;
  wind_speed_kmh: number;
  sunshine_hrs: number;
}

/** Joins raw observed_hourly rows against the cluster lookup table (hourly
 *  rows only store cluster_id, not the human-readable name/zone/coords). */
export function mapHourlyRows(
  hourly: ObservedHourlyDbRow[],
  clustersById: Map<number, ClusterLookupRow>
): HourlyExportRow[] {
  const rows: HourlyExportRow[] = [];
  for (const h of hourly) {
    const c = clustersById.get(h.cluster_id);
    if (!c) continue; // defensive: an orphaned row shouldn't happen given the FK, but never crash the export over it
    rows.push({
      obs_date: h.obs_date,
      obs_hour: h.obs_hour,
      state_label: c.state_label,
      cluster_name: c.cluster_name,
      geo_zone: c.geo_zone,
      latitude: c.latitude,
      longitude: c.longitude,
      temp_2m_c: h.temp_2m_c,
      rel_humidity_pct: h.rel_humidity_pct,
      precip_mm: h.precip_mm,
      wind_speed_kmh: h.wind_speed_kmh,
      sunshine_hrs: h.sunshine_hrs,
    });
  }
  return rows;
}

export interface DailyReportDbRow {
  obs_date: string;
  cutoff_hour_wat: number;
  cluster_metrics: ClusterMetrics[];
}

/** Flattens one daily_observed_reports row (whole-day, all-cluster JSONB) into
 *  one export row per cluster, so hourly and daily exports share the same
 *  "one row per cluster per time bucket" shape. The AI-written national
 *  summary/regional narrative is prose, not tabular data, and is deliberately
 *  left out — it belongs in the briefing card, not a spreadsheet cell. */
export function flattenDailyReports(reports: DailyReportDbRow[]): DailyExportRow[] {
  const rows: DailyExportRow[] = [];
  for (const report of reports) {
    for (const m of report.cluster_metrics ?? []) {
      rows.push({
        obs_date: report.obs_date,
        cutoff_hour_wat: report.cutoff_hour_wat,
        state_label: m.state_label,
        cluster_name: m.cluster_name,
        geo_zone: m.geo_zone,
        latitude: m.latitude,
        longitude: m.longitude,
        total_precip_mm: m.total_precip_mm,
        avg_humidity_pct: m.avg_humidity_pct,
        avg_wind_kmh: m.avg_wind_kmh,
        avg_temp_c: m.avg_temp_c,
        max_temp_c: m.max_temp_c,
        min_temp_c: m.min_temp_c,
        total_sunshine_hrs: m.total_sunshine_hrs,
        risk_flags: (m.risk_flags ?? []).map((f) => f.label).join("; "),
      });
    }
  }
  return rows;
}

// ----------------------------------------------------------------------------
// CSV writer
// ----------------------------------------------------------------------------

/**
 * Defuses CSV/spreadsheet formula injection: a cell beginning with
 * = + - @ (or a tab/CR) is interpreted as a formula by Excel/Sheets when the
 * CSV is opened, not displayed as the literal text. None of this app's
 * exported fields are attacker-controlled today — cluster name/state/zone
 * come from the fixed seed list in supabase/schema.sql, risk-flag labels are
 * fixed constants in computeRiskFlags(), and every other column is a number
 * — so there's no live exploit path through this export as currently built.
 * This is defense-in-depth against a future column that does carry freeform
 * text, consistent with the project's existing belt-and-suspenders posture
 * (see the RLS/grants comment in supabase/schema.sql).
 */
function sanitizeCsvCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvEscape(value: string | number): string {
  const str = sanitizeCsvCell(String(value));
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsv<T extends object>(
  rows: T[],
  columns: ExportColumn<T>[]
): string {
  const headerLine = columns.map((c) => csvEscape(c.header)).join(",");
  const dataLines = rows.map((row) =>
    columns.map((c) => csvEscape(row[c.key] as string | number)).join(",")
  );
  return [headerLine, ...dataLines].join("\r\n") + "\r\n";
}

// ----------------------------------------------------------------------------
// Filename helper — shared by the route so the Content-Disposition filename
// and any UI preview stay in sync. Built entirely from already-validated
// enum/regex-checked query params, so there's no header-injection surface
// from unsanitized user input here.
// ----------------------------------------------------------------------------
export function buildExportFilename(query: ExportQuery): string {
  return `growthly-gic_${query.type}_${query.start}_to_${query.end}.${query.format}`;
}
