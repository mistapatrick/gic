import { describe, expect, it } from "vitest";
import {
  DAILY_COLUMNS,
  HOURLY_COLUMNS,
  MAX_DAILY_RANGE_DAYS,
  MAX_HOURLY_RANGE_DAYS,
  buildCsv,
  buildExportFilename,
  flattenDailyReports,
  mapHourlyRows,
  validateDateRange,
  type ClusterLookupRow,
  type DailyReportDbRow,
  type ObservedHourlyDbRow,
} from "@/lib/domains/weather/export-logic";
import type { ClusterMetrics } from "@/lib/types";

describe("validateDateRange", () => {
  it("accepts a normal same-month range", () => {
    const result = validateDateRange("2026-03-01", "2026-03-10", "hourly");
    expect(result.ok).toBe(true);
    expect(result.rangeDays).toBe(10);
  });

  it("accepts a single-day range (start === end)", () => {
    const result = validateDateRange("2026-03-10", "2026-03-10", "daily");
    expect(result.ok).toBe(true);
    expect(result.rangeDays).toBe(1);
  });

  it("rejects start after end", () => {
    const result = validateDateRange("2026-03-10", "2026-03-01", "hourly");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/on or before/);
  });

  it("rejects a calendar-invalid date that JS Date silently rolls forward (e.g. Feb 30)", () => {
    // new Date("2026-02-30") does NOT throw — it rolls over to 2026-03-02.
    // This is the regression case the round-trip check in validateDateRange
    // exists for.
    const result = validateDateRange("2026-02-30", "2026-03-10", "hourly");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/valid calendar date/);
  });

  it("rejects a calendar-invalid end date the same way", () => {
    const result = validateDateRange("2026-03-01", "2026-02-30", "hourly");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/valid calendar date/);
  });

  it("accepts Feb 29 on a leap year", () => {
    const result = validateDateRange("2024-02-29", "2024-02-29", "hourly");
    expect(result.ok).toBe(true);
  });

  it("rejects Feb 29 on a non-leap year", () => {
    const result = validateDateRange("2026-02-29", "2026-02-29", "hourly");
    expect(result.ok).toBe(false);
  });

  it("rejects a hourly range beyond MAX_HOURLY_RANGE_DAYS", () => {
    const result = validateDateRange("2026-01-01", "2026-12-31", "hourly");
    expect(result.ok).toBe(false);
    expect(result.error).toContain(String(MAX_HOURLY_RANGE_DAYS));
  });

  it("accepts a daily range up to MAX_DAILY_RANGE_DAYS", () => {
    // exactly 366 days apart (2026-01-01 .. 2027-01-01 inclusive)
    const result = validateDateRange("2026-01-01", "2027-01-01", "daily");
    expect(result.ok).toBe(true);
    expect(result.rangeDays).toBe(MAX_DAILY_RANGE_DAYS);
  });

  it("rejects a daily range beyond MAX_DAILY_RANGE_DAYS", () => {
    const result = validateDateRange("2026-01-01", "2027-01-02", "daily");
    expect(result.ok).toBe(false);
  });
});

describe("mapHourlyRows", () => {
  const clustersById = new Map<number, ClusterLookupRow>([
    [
      1,
      {
        id: 1,
        state_label: "Anambra",
        cluster_name: "Ayamelum, Ogbaru, Anambra W.",
        geo_zone: "South-East",
        latitude: 6.4512,
        longitude: 6.9124,
      },
    ],
  ]);

  const hourlyRow: ObservedHourlyDbRow = {
    cluster_id: 1,
    obs_date: "2026-03-10",
    obs_hour: 14,
    temp_2m_c: 32.5,
    rel_humidity_pct: 60,
    precip_mm: 0,
    wind_speed_kmh: 12.3,
    sunshine_hrs: 0.8,
  };

  it("joins an hourly row against the cluster lookup", () => {
    const rows = mapHourlyRows([hourlyRow], clustersById);
    expect(rows).toEqual([
      {
        obs_date: "2026-03-10",
        obs_hour: 14,
        state_label: "Anambra",
        cluster_name: "Ayamelum, Ogbaru, Anambra W.",
        geo_zone: "South-East",
        latitude: 6.4512,
        longitude: 6.9124,
        temp_2m_c: 32.5,
        rel_humidity_pct: 60,
        precip_mm: 0,
        wind_speed_kmh: 12.3,
        sunshine_hrs: 0.8,
      },
    ]);
  });

  it("silently skips a row whose cluster_id has no matching lookup entry, instead of throwing", () => {
    const orphan: ObservedHourlyDbRow = { ...hourlyRow, cluster_id: 999 };
    expect(() => mapHourlyRows([orphan], clustersById)).not.toThrow();
    expect(mapHourlyRows([orphan], clustersById)).toHaveLength(0);
  });
});

describe("flattenDailyReports", () => {
  const metric: ClusterMetrics = {
    cluster_id: 1,
    slug: "anambra-ayamelum",
    state_label: "Anambra",
    cluster_name: "Ayamelum, Ogbaru, Anambra W.",
    geo_zone: "South-East",
    latitude: 6.4512,
    longitude: 6.9124,
    total_precip_mm: 12.4,
    avg_humidity_pct: 70,
    avg_wind_kmh: 15,
    avg_temp_c: 29.5,
    max_temp_c: 34,
    min_temp_c: 24,
    total_sunshine_hrs: 6.2,
    hourly: [],
    risk_flags: [
      { code: "heavy_rainfall", label: "Elevated rainfall observed", severity: "watch", detail: "x" },
    ],
  };

  it("flattens one report into one row per cluster", () => {
    const report: DailyReportDbRow = { obs_date: "2026-03-10", cutoff_hour_wat: 23, cluster_metrics: [metric] };
    const rows = flattenDailyReports([report]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      obs_date: "2026-03-10",
      cutoff_hour_wat: 23,
      state_label: "Anambra",
      total_precip_mm: 12.4,
    });
  });

  it("joins multiple risk flag labels with a semicolon", () => {
    const twoFlags: ClusterMetrics = {
      ...metric,
      risk_flags: [
        { code: "heavy_rainfall", label: "Elevated rainfall observed", severity: "watch", detail: "x" },
        { code: "heat_stress", label: "High daytime heat observed", severity: "watch", detail: "y" },
      ],
    };
    const rows = flattenDailyReports([{ obs_date: "2026-03-10", cutoff_hour_wat: 23, cluster_metrics: [twoFlags] }]);
    expect(rows[0]!.risk_flags).toBe("Elevated rainfall observed; High daytime heat observed");
  });

  it("produces an empty string (not undefined/null) for a cluster with no flags", () => {
    const noFlags: ClusterMetrics = { ...metric, risk_flags: [] };
    const rows = flattenDailyReports([{ obs_date: "2026-03-10", cutoff_hour_wat: 23, cluster_metrics: [noFlags] }]);
    expect(rows[0]!.risk_flags).toBe("");
  });

  it("flattens across multiple days and multiple clusters into obs_date x cluster rows", () => {
    const reports: DailyReportDbRow[] = [
      { obs_date: "2026-03-10", cutoff_hour_wat: 23, cluster_metrics: [metric, { ...metric, cluster_id: 2 }] },
      { obs_date: "2026-03-11", cutoff_hour_wat: 23, cluster_metrics: [metric] },
    ];
    const rows = flattenDailyReports(reports);
    expect(rows).toHaveLength(3);
  });

  it("handles a report with an empty cluster_metrics array without throwing", () => {
    const report: DailyReportDbRow = { obs_date: "2026-03-10", cutoff_hour_wat: 23, cluster_metrics: [] };
    expect(flattenDailyReports([report])).toEqual([]);
  });
});

describe("buildCsv", () => {
  it("writes a header row followed by one data row per input row, CRLF-terminated", () => {
    const csv = buildCsv(
      [{ a: "x", b: 1 }],
      [
        { key: "a", header: "A" },
        { key: "b", header: "B" },
      ]
    );
    expect(csv).toBe("A,B\r\nx,1\r\n");
  });

  it("quotes and escapes a field containing a comma, quote, or newline", () => {
    const csv = buildCsv(
      [{ a: 'has,comma and "quote"\nand newline' }],
      [{ key: "a", header: "A" }]
    );
    expect(csv).toBe('A\r\n"has,comma and ""quote""\nand newline"\r\n');
  });

  it("neutralizes a leading =, +, -, @ to prevent CSV formula injection on open", () => {
    const csv = buildCsv(
      [{ a: "=SUM(A1:A9)" }, { a: "+1+1" }, { a: "-1" }, { a: "@cmd" }],
      [{ key: "a", header: "A" }]
    );
    const lines = csv.trim().split("\r\n").slice(1); // drop header
    expect(lines).toEqual(["'=SUM(A1:A9)", "'+1+1", "'-1", "'@cmd"]);
  });

  it("leaves an ordinary value with an internal (non-leading) special character untouched", () => {
    const csv = buildCsv([{ a: "North-West" }], [{ key: "a", header: "A" }]);
    expect(csv).toBe("A\r\nNorth-West\r\n");
  });

  it("writes only the header row for an empty dataset", () => {
    const csv = buildCsv([], [{ key: "a", header: "A" }]);
    expect(csv).toBe("A\r\n");
  });

  it("round-trips the full HOURLY_COLUMNS / DAILY_COLUMNS header sets without throwing", () => {
    expect(() => buildCsv([], HOURLY_COLUMNS)).not.toThrow();
    expect(() => buildCsv([], DAILY_COLUMNS)).not.toThrow();
  });
});

describe("buildExportFilename", () => {
  it("builds a filename from the validated query, with the matching extension", () => {
    expect(
      buildExportFilename({ type: "hourly", format: "csv", start: "2026-03-01", end: "2026-03-10" })
    ).toBe("growthly-gic_hourly_2026-03-01_to_2026-03-10.csv");
    expect(
      buildExportFilename({ type: "daily", format: "xlsx", start: "2026-03-01", end: "2026-03-10" })
    ).toBe("growthly-gic_daily_2026-03-01_to_2026-03-10.xlsx");
  });
});
