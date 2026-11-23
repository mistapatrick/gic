import { describe, expect, it } from "vitest";
import {
  matchWorldBankColumn,
  parseWorldBankRtfpRecords,
  findLatestWorldBankCsvLink,
} from "@/lib/domains/commodity-prices/worldbank-rtfp-ingest-logic";

describe("matchWorldBankColumn", () => {
  it("matches a 'c_' prefixed column to a tracked commodity", () => {
    expect(matchWorldBankColumn("c_rice_fao")).toBe("Rice (paddy)");
    expect(matchWorldBankColumn("c_maize")).toBe("Maize");
    expect(matchWorldBankColumn("c_cassava_gari")).toBe("Cassava");
  });
  it("ignores non-'c_' prefixed columns even if they match a commodity substring", () => {
    expect(matchWorldBankColumn("o_rice_fao")).toBeNull();
    expect(matchWorldBankColumn("trust_rice_fao")).toBeNull();
  });
  it("returns null for columns matching no tracked commodity", () => {
    expect(matchWorldBankColumn("c_food_price_index")).toBeNull();
    expect(matchWorldBankColumn("c_wheat")).toBeNull(); // not one of GIC's 15
  });
});

describe("parseWorldBankRtfpRecords", () => {
  it("averages across markets within the same period into one national figure", () => {
    const records = [
      { iso3: "NGA", dates: "2026-03-01", c_rice_fao: "1200", c_maize: "300" },
      { iso3: "NGA", dates: "2026-03-01", c_rice_fao: "1400", c_maize: "320" },
    ];
    const result = parseWorldBankRtfpRecords(records);
    const rice = result.find((r) => r.commodity === "Rice (paddy)");
    const maize = result.find((r) => r.commodity === "Maize");
    expect(rice?.value).toBeCloseTo(1300);
    expect(maize?.value).toBeCloseTo(310);
    expect(rice?.source).toBe("WORLD_BANK_RTFP");
    expect(rice?.priceType).toBe("retail");
    expect(rice?.region).toBe("National");
  });

  it("filters out non-Nigeria rows when a country column is present", () => {
    const records = [
      { iso3: "NGA", dates: "2026-03-01", c_rice_fao: "1200" },
      { iso3: "NER", dates: "2026-03-01", c_rice_fao: "9999" },
    ];
    const result = parseWorldBankRtfpRecords(records);
    expect(result.find((r) => r.commodity === "Rice (paddy)")?.value).toBe(1200);
  });

  it("assumes Nigeria-only when no country column exists at all", () => {
    const records = [{ dates: "2026-03-01", c_maize: "500" }];
    expect(parseWorldBankRtfpRecords(records)).toHaveLength(1);
  });

  it("skips non-numeric, NA, and non-positive values", () => {
    const records = [
      { iso3: "NGA", dates: "2026-03-01", c_maize: "NA" },
      { iso3: "NGA", dates: "2026-04-01", c_maize: "-5" },
    ];
    expect(parseWorldBankRtfpRecords(records)).toHaveLength(0);
  });

  it("throws when no recognizable date column exists", () => {
    expect(() => parseWorldBankRtfpRecords([{ iso3: "NGA", c_maize: "500" }])).toThrow(/date column/i);
  });

  it("returns an empty array for no records", () => {
    expect(parseWorldBankRtfpRecords([])).toEqual([]);
  });
});

describe("findLatestWorldBankCsvLink", () => {
  it("extracts a dated NGA_RTFP_mkt csv filename from catalog page text", () => {
    const html = `<li>Data files</li><li>NGA_RTFP_mkt_2007_2026-04-20.csv</li>`;
    const link = findLatestWorldBankCsvLink(html);
    expect(link).toContain("NGA_RTFP_mkt_2007_2026-04-20.csv");
  });

  it("prefers an actual href wrapping the filename when one exists", () => {
    const html = `<a href="/catalog/4503/get-microdata/NGA_RTFP_mkt_2007_2026-04-20.csv">download</a>`;
    const link = findLatestWorldBankCsvLink(html);
    expect(link).toBe("https://microdata.worldbank.org/catalog/4503/get-microdata/NGA_RTFP_mkt_2007_2026-04-20.csv");
  });

  it("returns null when no dated filename is present", () => {
    expect(findLatestWorldBankCsvLink("<p>nothing here</p>")).toBeNull();
  });
});
