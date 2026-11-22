import { describe, expect, it } from "vitest";
import {
  buildAiPrompt,
  buildCompactTelemetry,
  buildOpenMeteoUrl,
  computeRiskFlags,
  getCutoffHour,
  getLagosDateParts,
  OpenMeteoResponseSchema,
  parseIngestionResults,
  type ClusterRow,
} from "@/lib/domains/weather/ingest-logic";

const CLUSTERS: ClusterRow[] = [
  {
    id: 1,
    slug: "anambra-ayamelum",
    state_label: "Anambra",
    cluster_name: "Ayamelum, Ogbaru, Anambra W.",
    geo_zone: "South-East",
    latitude: 6.4512,
    longitude: 6.9124,
  },
  {
    id: 2,
    slug: "kano-kadawa",
    state_label: "Kano",
    cluster_name: "Kano River Basin & Kadawa",
    geo_zone: "North-West",
    latitude: 11.6442,
    longitude: 8.4319,
  },
];

function makeHourlyBlock(obsDate: string, hours: number) {
  const time: string[] = [];
  const temperature_2m: number[] = [];
  const relative_humidity_2m: number[] = [];
  const precipitation: number[] = [];
  const wind_speed_10m: number[] = [];
  const sunshine_duration: number[] = [];

  for (let h = 0; h < hours; h++) {
    time.push(`${obsDate}T${String(h).padStart(2, "0")}:00`);
    temperature_2m.push(24 + h * 0.5);
    relative_humidity_2m.push(60 + h);
    precipitation.push(h === 6 ? 4.2 : 0);
    wind_speed_10m.push(5 + h * 0.2);
    sunshine_duration.push(h >= 6 && h <= 18 ? 3000 : 0);
  }
  return { time, temperature_2m, relative_humidity_2m, precipitation, wind_speed_10m, sunshine_duration };
}

/** Wraps a flat hourly block into the `{ hourly: {...} }` shape a single
 *  Open-Meteo location entry actually has. */
function loc(block: ReturnType<typeof makeHourlyBlock>) {
  return { hourly: block };
}

describe("getLagosDateParts / getCutoffHour", () => {
  it("computes Africa/Lagos (UTC+1, no DST) date & hour from a UTC instant", () => {
    // 2026-03-10T21:05:00Z -> Lagos is UTC+1 -> 2026-03-10T22:05 WAT
    const { obsDate, currentHour } = getLagosDateParts(new Date("2026-03-10T21:05:00Z"));
    expect(obsDate).toBe("2026-03-10");
    expect(currentHour).toBe(22);
  });

  it("rolls over to the next Lagos calendar day near UTC midnight", () => {
    // 2026-03-10T23:30:00Z -> +1h -> 2026-03-11T00:30 WAT
    const { obsDate, currentHour } = getLagosDateParts(new Date("2026-03-10T23:30:00Z"));
    expect(obsDate).toBe("2026-03-11");
    expect(currentHour).toBe(0);
  });

  it("returns the full day — hour 23 — once the 23:59 WAT run has it", () => {
    expect(getCutoffHour(23)).toBe(23);
  });

  it("defensively clamps an out-of-range hour value to 23, the last hour of the day", () => {
    // getLagosDateParts() never actually produces an hour above 23, but the
    // clamp is kept as a defensive guard against a misbehaving caller.
    expect(getCutoffHour(25)).toBe(23);
  });

  it("clamps a negative hour to 0 defensively", () => {
    expect(getCutoffHour(-5)).toBe(0);
  });

  it("passes through hours within the valid 0-23 range unchanged (manual daytime backfill runs)", () => {
    expect(getCutoffHour(9)).toBe(9);
  });
});

describe("buildOpenMeteoUrl", () => {
  it("batches every cluster into a single comma-separated request (1 API call per night)", () => {
    const url = buildOpenMeteoUrl(CLUSTERS);
    expect(url).toContain("latitude=6.4512,11.6442");
    expect(url).toContain("longitude=6.9124,8.4319");
    // forecast_days=1 is required so the API returns TODAY's date at all —
    // forecast_days counts days starting from today, so 0 would return only
    // past_days and never today. "Observed only" is enforced separately by
    // the hour-cutoff filter in parseIngestionResults, not by this flag.
    expect(url).toContain("forecast_days=1");
    expect(url).toContain("past_days=1");
    expect(url).toContain("sunshine_duration");
  });
});

describe("parseIngestionResults never includes today's date from a stale/past-only response", () => {
  it("returns zero hourlyRows if the API response only covers yesterday (regression: forecast_days=0 bug)", () => {
    // Simulates the exact production bug: an Open-Meteo response built with
    // forecast_days=0 only ever contains yesterday's 24 hours, never today's
    // — so no row can ever match obsDate, whatever the cutoff hour is.
    const staleResponse = [loc(makeHourlyBlock("2026-11-17", 24))];
    const { hourlyRows } = parseIngestionResults(staleResponse, [CLUSTERS[0]], "2026-11-18", 21);
    expect(hourlyRows).toHaveLength(0);
  });

  it("returns the elapsed hours when the response correctly includes obsDate (forecast_days=1 fix)", () => {
    const freshResponse = [loc(makeHourlyBlock("2026-11-18", 3))]; // hours 00, 01, 02
    // currentHour=1 at the moment of a very-early-morning manual trigger.
    const { hourlyRows } = parseIngestionResults(freshResponse, [CLUSTERS[0]], "2026-11-18", 1);
    expect(hourlyRows).toHaveLength(2); // hours 00 and 01 only, never hour 02
  });
});

describe("parseIngestionResults", () => {
  it("never ingests an hour beyond the cutoff (no projected/future hours)", () => {
    const obsDate = "2026-03-10";
    const raw = [loc(makeHourlyBlock(obsDate, 24)), loc(makeHourlyBlock(obsDate, 24))];
    const parsed = OpenMeteoResponseSchema.parse(raw);
    const { hourlyRows } = parseIngestionResults(parsed, CLUSTERS, obsDate, 21);

    const maxHourIngested = Math.max(...hourlyRows.map((r) => r.obs_hour));
    expect(maxHourIngested).toBe(21);
    expect(hourlyRows.every((r) => r.obs_hour <= 21)).toBe(true);
    // 22 hours (00:00..21:00) per cluster x 2 clusters
    expect(hourlyRows.length).toBe(22 * 2);
  });

  it("ingests the full day including hour 23, now that the nightly run fires at 23:59 WAT (regression: hours 22-23 were structurally unreachable under the old 22:00 WAT / cutoff-21 schedule)", () => {
    const obsDate = "2026-03-10";
    const raw = [loc(makeHourlyBlock(obsDate, 24)), loc(makeHourlyBlock(obsDate, 24))];
    const parsed = OpenMeteoResponseSchema.parse(raw);
    const { hourlyRows } = parseIngestionResults(parsed, CLUSTERS, obsDate, 23);

    const maxHourIngested = Math.max(...hourlyRows.map((r) => r.obs_hour));
    expect(maxHourIngested).toBe(23);
    expect(hourlyRows.some((r) => r.obs_hour === 22)).toBe(true);
    expect(hourlyRows.some((r) => r.obs_hour === 23)).toBe(true);
    // 24 hours (00:00..23:00) per cluster x 2 clusters
    expect(hourlyRows.length).toBe(24 * 2);
  });

  it("discards hours from a different date (e.g. yesterday, included via past_days=1)", () => {
    const obsDate = "2026-03-10";
    const yesterdayBlock = makeHourlyBlock("2026-03-09", 24);
    const todayBlock = makeHourlyBlock(obsDate, 10);
    // Open-Meteo returns one combined hourly series; simulate by concatenating.
    const combined = {
      hourly: {
        time: [...yesterdayBlock.time, ...todayBlock.time],
        temperature_2m: [...yesterdayBlock.temperature_2m, ...todayBlock.temperature_2m],
        relative_humidity_2m: [...yesterdayBlock.relative_humidity_2m, ...todayBlock.relative_humidity_2m],
        precipitation: [...yesterdayBlock.precipitation, ...todayBlock.precipitation],
        wind_speed_10m: [...yesterdayBlock.wind_speed_10m, ...todayBlock.wind_speed_10m],
        sunshine_duration: [...yesterdayBlock.sunshine_duration, ...todayBlock.sunshine_duration],
      },
    };
    const parsed = OpenMeteoResponseSchema.parse([combined, combined]);
    const { hourlyRows } = parseIngestionResults(parsed, CLUSTERS, obsDate, 21);

    expect(hourlyRows.every((r) => r.obs_date === obsDate)).toBe(true);
    expect(hourlyRows.length).toBe(10 * 2); // only today's 10 hours per cluster
  });

  it("is deterministic — running the same input twice produces byte-identical rows (idempotency precondition)", () => {
    const obsDate = "2026-03-10";
    const raw = OpenMeteoResponseSchema.parse([loc(makeHourlyBlock(obsDate, 24)), loc(makeHourlyBlock(obsDate, 24))]);

    const first = parseIngestionResults(raw, CLUSTERS, obsDate, 21);
    const second = parseIngestionResults(raw, CLUSTERS, obsDate, 21);

    expect(second.hourlyRows).toEqual(first.hourlyRows);
    expect(second.clusterMetrics).toEqual(first.clusterMetrics);
  });

  it("produces exactly one row per (cluster, hour) — the pair the DB unique constraint keys on", () => {
    const obsDate = "2026-03-10";
    const raw = OpenMeteoResponseSchema.parse([loc(makeHourlyBlock(obsDate, 24)), loc(makeHourlyBlock(obsDate, 24))]);
    const { hourlyRows } = parseIngestionResults(raw, CLUSTERS, obsDate, 21);

    const seen = new Set<string>();
    for (const row of hourlyRows) {
      const key = `${row.cluster_id}|${row.obs_date}|${row.obs_hour}`;
      expect(seen.has(key)).toBe(false); // no duplicate key within a single run
      seen.add(key);
    }
  });

  it("clamps negative precipitation/wind readings to zero rather than writing a negative value", () => {
    const obsDate = "2026-03-10";
    const block = makeHourlyBlock(obsDate, 3);
    block.precipitation[1] = -0.3; // sensor noise from upstream
    block.wind_speed_10m[1] = -1.1;
    const parsed = OpenMeteoResponseSchema.parse([loc(block)]);

    const { hourlyRows } = parseIngestionResults(parsed, [CLUSTERS[0]!], obsDate, 2);
    const hour1 = hourlyRows.find((r) => r.obs_hour === 1)!;
    expect(hour1.precip_mm).toBe(0);
    expect(hour1.wind_speed_kmh).toBe(0);
  });

  it("clamps humidity into [0, 100] even if upstream sends an out-of-range reading", () => {
    const obsDate = "2026-03-10";
    const block = makeHourlyBlock(obsDate, 2);
    block.relative_humidity_2m[0] = 140;
    block.relative_humidity_2m[1] = -20;
    const parsed = OpenMeteoResponseSchema.parse([loc(block)]);

    const { hourlyRows } = parseIngestionResults(parsed, [CLUSTERS[0]!], obsDate, 1);
    expect(hourlyRows.find((r) => r.obs_hour === 0)!.rel_humidity_pct).toBe(100);
    expect(hourlyRows.find((r) => r.obs_hour === 1)!.rel_humidity_pct).toBe(0);
  });

  it("handles a cluster count/response length mismatch defensively instead of throwing", () => {
    const obsDate = "2026-03-10";
    // API returns 2 location blocks, but only 1 cluster is registered locally.
    const parsed = OpenMeteoResponseSchema.parse([
      loc(makeHourlyBlock(obsDate, 5)),
      loc(makeHourlyBlock(obsDate, 5)),
    ]);
    let result: ReturnType<typeof parseIngestionResults> | undefined;
    expect(() => {
      result = parseIngestionResults(parsed, [CLUSTERS[0]!], obsDate, 4);
    }).not.toThrow();
    expect(result!.clusterMetrics).toHaveLength(1); // the unmatched second block is skipped, not crashed on
  });
});

describe("OpenMeteoResponseSchema (untrusted upstream API validation)", () => {
  it("rejects a response missing required hourly arrays", () => {
    const bad = { hourly: { time: ["2026-03-10T00:00"] /* missing temperature_2m etc. */ } };
    expect(OpenMeteoResponseSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a completely malformed/unexpected payload shape", () => {
    expect(OpenMeteoResponseSchema.safeParse({ error: "rate limited" }).success).toBe(false);
    expect(OpenMeteoResponseSchema.safeParse(null).success).toBe(false);
    expect(OpenMeteoResponseSchema.safeParse("not json").success).toBe(false);
  });

  it("accepts a single-location object by wrapping it in an array (matches Open-Meteo's single-coordinate shape)", () => {
    const single = makeHourlyBlock("2026-03-10", 3);
    const result = OpenMeteoResponseSchema.safeParse({ hourly: single });
    expect(result.success).toBe(true);
    if (result.success) expect(Array.isArray(result.data)).toBe(true);
  });
});

describe("computeRiskFlags (deterministic agronomic flags)", () => {
  const calm = {
    total_precip_mm: 5,
    avg_humidity_pct: 65,
    total_sunshine_hrs: 7,
    max_temp_c: 33,
    avg_wind_kmh: 10,
  };

  it("flags nothing on an unremarkable day", () => {
    expect(computeRiskFlags(calm)).toEqual([]);
  });

  it("flags heavy rainfall at alert severity at/above 50mm", () => {
    const flags = computeRiskFlags({ ...calm, total_precip_mm: 60 });
    expect(flags).toEqual([
      expect.objectContaining({ code: "heavy_rainfall", severity: "alert" }),
    ]);
  });

  it("flags elevated rainfall at watch severity at/above 25mm but below 50mm", () => {
    const flags = computeRiskFlags({ ...calm, total_precip_mm: 25 });
    expect(flags).toEqual([
      expect.objectContaining({ code: "heavy_rainfall", severity: "watch" }),
    ]);
  });

  it("does not flag rainfall just under the watch threshold", () => {
    const flags = computeRiskFlags({ ...calm, total_precip_mm: 24.9 });
    expect(flags.find((f) => f.code === "heavy_rainfall")).toBeUndefined();
  });

  it("flags zero rainfall as informational only (not watch/alert)", () => {
    const flags = computeRiskFlags({ ...calm, total_precip_mm: 0 });
    expect(flags).toEqual([expect.objectContaining({ code: "no_rainfall", severity: "info" })]);
  });

  it("flags drying/spoilage risk at alert severity for high humidity + very low sunshine", () => {
    const flags = computeRiskFlags({ ...calm, avg_humidity_pct: 85, total_sunshine_hrs: 2 });
    expect(flags).toEqual([expect.objectContaining({ code: "drying_risk", severity: "alert" })]);
  });

  it("flags limited drying conditions at watch severity for the lighter threshold", () => {
    const flags = computeRiskFlags({ ...calm, avg_humidity_pct: 72, total_sunshine_hrs: 3.5 });
    expect(flags).toEqual([expect.objectContaining({ code: "drying_risk", severity: "watch" })]);
  });

  it("flags severe heat at alert severity at/above 42C", () => {
    const flags = computeRiskFlags({ ...calm, max_temp_c: 43 });
    expect(flags).toEqual([expect.objectContaining({ code: "heat_stress", severity: "alert" })]);
  });

  it("flags high daytime heat at watch severity at/above 38C but below 42C", () => {
    const flags = computeRiskFlags({ ...calm, max_temp_c: 39 });
    expect(flags).toEqual([expect.objectContaining({ code: "heat_stress", severity: "watch" })]);
  });

  it("flags elevated wind at watch severity at/above 45 km/h", () => {
    const flags = computeRiskFlags({ ...calm, avg_wind_kmh: 50 });
    expect(flags).toEqual([expect.objectContaining({ code: "high_wind", severity: "watch" })]);
  });

  it("flags breezy conditions at informational severity at/above 30 km/h but below 45", () => {
    const flags = computeRiskFlags({ ...calm, avg_wind_kmh: 35 });
    expect(flags).toEqual([expect.objectContaining({ code: "high_wind", severity: "info" })]);
  });

  it("raises independent flags together when multiple thresholds are crossed the same day", () => {
    const flags = computeRiskFlags({
      total_precip_mm: 60,
      avg_humidity_pct: 65,
      total_sunshine_hrs: 7,
      max_temp_c: 43,
      avg_wind_kmh: 50,
    });
    const codes = flags.map((f) => f.code).sort();
    expect(codes).toEqual(["heat_stress", "heavy_rainfall", "high_wind"]);
  });

  it("is deterministic for identical input", () => {
    expect(computeRiskFlags(calm)).toEqual(computeRiskFlags(calm));
  });
});

describe("parseIngestionResults attaches risk_flags to every cluster", () => {
  it("computes risk_flags from that cluster's own totals, embedded in clusterMetrics", () => {
    const obsDate = "2026-03-10";
    const raw = OpenMeteoResponseSchema.parse([loc(makeHourlyBlock(obsDate, 24))]);
    const { clusterMetrics } = parseIngestionResults(raw, [CLUSTERS[0]!], obsDate, 21);

    expect(clusterMetrics[0]!.risk_flags).toEqual(
      computeRiskFlags({
        total_precip_mm: clusterMetrics[0]!.total_precip_mm,
        avg_humidity_pct: clusterMetrics[0]!.avg_humidity_pct,
        total_sunshine_hrs: clusterMetrics[0]!.total_sunshine_hrs,
        max_temp_c: clusterMetrics[0]!.max_temp_c,
        avg_wind_kmh: clusterMetrics[0]!.avg_wind_kmh,
      })
    );
  });
});

describe("buildCompactTelemetry / buildAiPrompt", () => {
  it("builds a prompt that explicitly forbids speculation and is grounded in the telemetry JSON", () => {
    const obsDate = "2026-03-10";
    const raw = OpenMeteoResponseSchema.parse([loc(makeHourlyBlock(obsDate, 24))]);
    const { clusterMetrics } = parseIngestionResults(raw, [CLUSTERS[0]!], obsDate, 21);
    const compact = buildCompactTelemetry(clusterMetrics);
    const prompt = buildAiPrompt(obsDate, 21, compact);

    expect(prompt).toContain("NOT a");
    expect(prompt).toContain(obsDate);
    expect(prompt).toContain(JSON.stringify(compact));
  });

  it("includes each cluster's deterministic flag labels in the compact telemetry", () => {
    const compact = buildCompactTelemetry([
      {
        cluster_id: 1,
        slug: "x",
        state_label: "X",
        cluster_name: "X",
        geo_zone: "South-East",
        latitude: 0,
        longitude: 0,
        total_precip_mm: 60,
        avg_humidity_pct: 65,
        avg_wind_kmh: 10,
        avg_temp_c: 30,
        max_temp_c: 33,
        min_temp_c: 25,
        total_sunshine_hrs: 7,
        hourly: [],
        risk_flags: computeRiskFlags({
          total_precip_mm: 60,
          avg_humidity_pct: 65,
          total_sunshine_hrs: 7,
          max_temp_c: 33,
          avg_wind_kmh: 10,
        }),
      },
    ]);
    expect(compact[0]!.flags).toEqual(["Heavy rainfall observed"]);
  });

  it("instructs the model to treat flags as ground truth it must stay consistent with", () => {
    const prompt = buildAiPrompt("2026-03-10", 21, []);
    expect(prompt.toLowerCase()).toContain("ground truth");
  });
});
