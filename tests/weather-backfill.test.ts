import { describe, expect, it } from "vitest";
import { buildArchiveUrl, enumerateDates, parseWeatherBackfillChunk } from "@/lib/domains/weather/backfill";
import type { ClusterRow } from "@/lib/domains/weather/ingest-logic";

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
];

function makeHourlyBlockForRange(dates: string[]) {
  const time: string[] = [];
  const temperature_2m: number[] = [];
  const relative_humidity_2m: number[] = [];
  const precipitation: number[] = [];
  const wind_speed_10m: number[] = [];
  const sunshine_duration: number[] = [];

  for (const date of dates) {
    for (let h = 0; h < 24; h++) {
      time.push(`${date}T${String(h).padStart(2, "0")}:00`);
      temperature_2m.push(25);
      relative_humidity_2m.push(65);
      precipitation.push(0);
      wind_speed_10m.push(10);
      sunshine_duration.push(h >= 6 && h <= 18 ? 3000 : 0);
    }
  }
  return [{ hourly: { time, temperature_2m, relative_humidity_2m, precipitation, wind_speed_10m, sunshine_duration } }];
}

describe("enumerateDates", () => {
  it("includes both endpoints inclusive", () => {
    expect(enumerateDates("2020-01-01", "2020-01-03")).toEqual([
      "2020-01-01",
      "2020-01-02",
      "2020-01-03",
    ]);
  });
  it("returns a single date when start equals end", () => {
    expect(enumerateDates("2020-06-15", "2020-06-15")).toEqual(["2020-06-15"]);
  });
  it("crosses a month boundary", () => {
    expect(enumerateDates("2020-01-30", "2020-02-01")).toEqual([
      "2020-01-30",
      "2020-01-31",
      "2020-02-01",
    ]);
  });
});

describe("buildArchiveUrl", () => {
  it("points at the archive endpoint, not the forecast one", () => {
    const url = buildArchiveUrl(CLUSTERS, "2020-01-01", "2020-01-31");
    expect(url).toContain("archive-api.open-meteo.com/v1/archive");
    expect(url).not.toContain("/v1/forecast");
  });
  it("includes the requested date range and all cluster coordinates", () => {
    const url = buildArchiveUrl(CLUSTERS, "2020-01-01", "2020-01-31");
    expect(url).toContain("start_date=2020-01-01");
    expect(url).toContain("end_date=2020-01-31");
    expect(url).toContain(`latitude=${CLUSTERS[0].latitude}`);
    expect(url).toContain(`longitude=${CLUSTERS[0].longitude}`);
  });
});

describe("parseWeatherBackfillChunk", () => {
  it("produces one daily report and 24 hourly rows per day in the chunk", () => {
    const dates = ["2020-01-01", "2020-01-02", "2020-01-03"];
    const omData = makeHourlyBlockForRange(dates);

    const { hourlyRows, dailyReports } = parseWeatherBackfillChunk(
      omData,
      CLUSTERS,
      "2020-01-01",
      "2020-01-03"
    );

    expect(dailyReports).toHaveLength(3);
    expect(hourlyRows).toHaveLength(3 * 24);
    expect(dailyReports.map((r) => r.obs_date)).toEqual(dates);
  });

  it("every backfilled daily report uses cutoff_hour_wat 23 (fully elapsed day)", () => {
    const dates = ["2020-01-01"];
    const omData = makeHourlyBlockForRange(dates);
    const { dailyReports } = parseWeatherBackfillChunk(omData, CLUSTERS, "2020-01-01", "2020-01-01");
    expect(dailyReports[0].cutoff_hour_wat).toBe(23);
  });

  it("flags the placeholder summary as backfilled, not AI-authored", () => {
    const omData = makeHourlyBlockForRange(["2020-01-01"]);
    const { dailyReports } = parseWeatherBackfillChunk(omData, CLUSTERS, "2020-01-01", "2020-01-01");
    expect(dailyReports[0].national_summary.toLowerCase()).toContain("backfilled");
    expect(dailyReports[0].regional_insights).toEqual([]);
  });

  it("skips a date with no matching data instead of producing an empty-but-present report", () => {
    // omData only covers 2020-01-01, but the chunk requests through 01-02.
    const omData = makeHourlyBlockForRange(["2020-01-01"]);
    const { dailyReports } = parseWeatherBackfillChunk(omData, CLUSTERS, "2020-01-01", "2020-01-02");
    expect(dailyReports).toHaveLength(1);
    expect(dailyReports[0].obs_date).toBe("2020-01-01");
  });

  it("computes real cluster_metrics (not placeholders) for each backfilled day", () => {
    const omData = makeHourlyBlockForRange(["2020-01-01"]);
    const { dailyReports } = parseWeatherBackfillChunk(omData, CLUSTERS, "2020-01-01", "2020-01-01");
    expect(dailyReports[0].cluster_metrics).toHaveLength(1);
    expect(dailyReports[0].cluster_metrics[0].avg_temp_c).toBeCloseTo(25, 0);
  });
});
