import { describe, expect, it } from "vitest";
import {
  enumerateYears,
  matchCommodity,
  matchMetric,
  parseFaostatRecords,
  buildFaostatUrl,
  FAOSTAT_AREA_CODE_NIGERIA,
} from "@/lib/domains/production-conditions/ingest-logic";

function faostatResponse(records: unknown[]) {
  return { data: records };
}

const NIGERIA_MAIZE_PRODUCTION = {
  "Area Code": 159,
  Area: "Nigeria",
  "Item Code": 56,
  Item: "Maize (corn)",
  "Element Code": 5510,
  Element: "Production",
  Year: 2023,
  Unit: "t",
  Value: 12_000_000,
};

describe("enumerateYears", () => {
  it("includes both endpoints inclusive", () => {
    expect(enumerateYears("1990-01-01", "1992-12-31")).toEqual([1990, 1991, 1992]);
  });
  it("returns a single year when start and end fall in the same year", () => {
    expect(enumerateYears("2020-03-01", "2020-11-30")).toEqual([2020]);
  });
});

describe("buildFaostatUrl", () => {
  it("points at the FAOSTAT QCL domain with area and comma-separated years", () => {
    const url = buildFaostatUrl(FAOSTAT_AREA_CODE_NIGERIA, [2020, 2021]);
    expect(url).toContain("fenixservices.fao.org/faostat/api/v1/en/data/QCL");
    expect(url).toContain(`area=${FAOSTAT_AREA_CODE_NIGERIA}`);
    expect(url).toContain("year=2020,2021");
  });
  it("omits item/element params (filtered client-side instead)", () => {
    const url = buildFaostatUrl(FAOSTAT_AREA_CODE_NIGERIA, [2020]);
    expect(url).not.toContain("item=");
    expect(url).not.toContain("element=");
  });
});

describe("matchCommodity", () => {
  it("matches an exact known item name", () => {
    expect(matchCommodity("Sorghum")).toBe("Sorghum");
  });
  it("matches a known alternate naming variant", () => {
    expect(matchCommodity("Maize")).toBe("Maize");
    expect(matchCommodity("Maize (corn)")).toBe("Maize");
  });
  it("returns null for an untracked item", () => {
    expect(matchCommodity("Bananas")).toBeNull();
  });
});

describe("matchMetric", () => {
  it("maps Production to production_quantity", () => {
    expect(matchMetric("Production")).toBe("production_quantity");
  });
  it("maps Yield to yield", () => {
    expect(matchMetric("Yield")).toBe("yield");
  });
  it("maps Area harvested to area_harvested", () => {
    expect(matchMetric("Area harvested")).toBe("area_harvested");
  });
  it("returns null for an untracked element", () => {
    expect(matchMetric("Stocks")).toBeNull();
  });
});

describe("parseFaostatRecords", () => {
  it("parses a valid Nigeria record into a ProductionConditionRow", () => {
    const rows = parseFaostatRecords(faostatResponse([NIGERIA_MAIZE_PRODUCTION]), FAOSTAT_AREA_CODE_NIGERIA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      commodity: "Maize",
      metric: "production_quantity",
      value: 12_000_000,
      unit: "t",
      year: 2023,
      region: "National",
      source: "FAOSTAT",
    });
  });

  it("throws loudly if any returned row's Area is not Nigeria", () => {
    const wrongCountryRecord = { ...NIGERIA_MAIZE_PRODUCTION, Area: "Ghana" };
    expect(() =>
      parseFaostatRecords(faostatResponse([wrongCountryRecord]), FAOSTAT_AREA_CODE_NIGERIA)
    ).toThrow(/not Nigeria/);
  });

  it("returns an empty array (not an error) when no records are returned", () => {
    expect(parseFaostatRecords(faostatResponse([]), FAOSTAT_AREA_CODE_NIGERIA)).toEqual([]);
  });

  it("skips a record whose item isn't a tracked commodity", () => {
    const untracked = { ...NIGERIA_MAIZE_PRODUCTION, Item: "Bananas" };
    expect(parseFaostatRecords(faostatResponse([untracked]), FAOSTAT_AREA_CODE_NIGERIA)).toEqual([]);
  });

  it("skips a record whose element isn't a tracked metric", () => {
    const untracked = { ...NIGERIA_MAIZE_PRODUCTION, Element: "Stocks" };
    expect(parseFaostatRecords(faostatResponse([untracked]), FAOSTAT_AREA_CODE_NIGERIA)).toEqual([]);
  });

  it("skips a record with a null Value (not yet published)", () => {
    const unpublished = { ...NIGERIA_MAIZE_PRODUCTION, Value: null };
    expect(parseFaostatRecords(faostatResponse([unpublished]), FAOSTAT_AREA_CODE_NIGERIA)).toEqual([]);
  });

  it("throws on a malformed response shape", () => {
    expect(() => parseFaostatRecords({ not: "the expected shape" }, FAOSTAT_AREA_CODE_NIGERIA)).toThrow();
  });

  it("carries the FAOSTAT codes through for traceability", () => {
    const rows = parseFaostatRecords(faostatResponse([NIGERIA_MAIZE_PRODUCTION]), FAOSTAT_AREA_CODE_NIGERIA);
    expect(rows[0].faostat_area_code).toBe(159);
    expect(rows[0].faostat_item_code).toBe(56);
    expect(rows[0].faostat_element_code).toBe(5510);
  });
});
