import { describe, expect, it } from "vitest";
import {
  matchFewsNetProductName,
  parseFewsNetRecords,
  findHdxResourceUrl,
} from "@/lib/domains/commodity-prices/fewsnet-ingest-logic";

describe("matchFewsNetProductName", () => {
  it("matches a product_name to a tracked commodity", () => {
    expect(matchFewsNetProductName("Maize (white)")).toBe("Maize");
    expect(matchFewsNetProductName("Rice, milled")).toBe("Rice (paddy)");
    expect(matchFewsNetProductName("Cassava (gari)")).toBe("Cassava");
  });
  it("returns null for a product name matching no tracked commodity", () => {
    expect(matchFewsNetProductName("Wheat flour")).toBeNull();
  });
});

describe("parseFewsNetRecords", () => {
  const baseRow = {
    country: "Nigeria",
    market: "Kano Central",
    product_name: "Maize (white)",
    price_type: "Retail",
    unit: "KG",
    price: "350",
    period_date: "2024-08-01",
  };

  it("averages across markets within the same period into one national figure", () => {
    const records = [
      baseRow,
      { ...baseRow, market: "Dawanau", price: "370" },
    ];
    const result = parseFewsNetRecords(records);
    const maize = result.find((r) => r.commodity === "Maize");
    expect(maize?.value).toBeCloseTo(360);
    expect(maize?.source).toBe("FEWS_NET");
    expect(maize?.priceType).toBe("retail");
    expect(maize?.region).toBe("National");
    expect(maize?.unit).toBe("NGN per kg");
  });

  it("filters out non-retail price types", () => {
    const records = [baseRow, { ...baseRow, price_type: "Wholesale", price: "9999" }];
    const result = parseFewsNetRecords(records);
    expect(result.find((r) => r.commodity === "Maize")?.value).toBe(350);
  });

  it("filters out non-Nigeria rows when a country column is present", () => {
    const records = [baseRow, { ...baseRow, country: "Niger", price: "9999" }];
    const result = parseFewsNetRecords(records);
    expect(result.find((r) => r.commodity === "Maize")?.value).toBe(350);
  });

  it("assumes Nigeria-only when no country column exists at all", () => {
    const { country: _country, ...rest } = baseRow;
    void _country;
    expect(parseFewsNetRecords([rest])).toHaveLength(1);
  });

  it("skips NC, NA, and non-positive price values", () => {
    const records = [
      { ...baseRow, price: "NC" },
      { ...baseRow, period_date: "2024-09-01", price: "NA" },
      { ...baseRow, period_date: "2024-10-01", price: "-5" },
    ];
    expect(parseFewsNetRecords(records)).toHaveLength(0);
  });

  it("skips rows whose product_name matches no tracked commodity", () => {
    expect(parseFewsNetRecords([{ ...baseRow, product_name: "Wheat flour" }])).toHaveLength(0);
  });

  it("throws when a required column is missing", () => {
    expect(() => parseFewsNetRecords([{ country: "Nigeria" }])).toThrow(/missing a required column/i);
  });

  it("returns an empty array for no records", () => {
    expect(parseFewsNetRecords([])).toEqual([]);
  });
});

describe("findHdxResourceUrl", () => {
  it("finds the resource matching the requested format", () => {
    const json = {
      result: {
        resources: [
          { format: "XLSX", url: "https://data.humdata.org/x.xlsx" },
          { format: "JSON", url: "https://data.humdata.org/x.json" },
        ],
      },
    };
    expect(findHdxResourceUrl(json, "JSON")).toBe("https://data.humdata.org/x.json");
  });

  it("matches format case-insensitively", () => {
    const json = { result: { resources: [{ format: "json", url: "https://x/y.json" }] } };
    expect(findHdxResourceUrl(json, "JSON")).toBe("https://x/y.json");
  });

  it("throws when no resource of the requested format exists", () => {
    const json = { result: { resources: [{ format: "CSV", url: "https://x/y.csv" }] } };
    expect(() => findHdxResourceUrl(json, "JSON")).toThrow(/no "JSON"-format resource/i);
  });

  it("throws when the response has no result object", () => {
    expect(() => findHdxResourceUrl({}, "JSON")).toThrow(/no 'result' object/i);
  });

  it("throws when result.resources is not an array", () => {
    expect(() => findHdxResourceUrl({ result: {} }, "JSON")).toThrow(/not an array/i);
  });
});
