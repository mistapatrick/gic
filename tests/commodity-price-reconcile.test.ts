import { describe, expect, it } from "vitest";
import {
  reconcileCommodityPrices,
  priceTypeForSource,
  normalizeManualCommodityEntry,
  type NormalizedPriceObservation,
} from "@/lib/domains/commodity-prices/price-types";

function obs(partial: Partial<NormalizedPriceObservation> & { commodity: string }): NormalizedPriceObservation {
  return {
    source: "NBS",
    priceType: "retail",
    value: 0,
    unit: "NGN per kg",
    currency: "NGN",
    periodDate: "2026-01-01",
    region: "National",
    ...partial,
  };
}

describe("priceTypeForSource", () => {
  it("treats NBS and World Bank RTFP as retail", () => {
    expect(priceTypeForSource("NBS")).toBe("retail");
    expect(priceTypeForSource("WORLD_BANK_RTFP")).toBe("retail");
  });
  it("treats AFEX as exchange_spot", () => {
    expect(priceTypeForSource("AFEX")).toBe("exchange_spot");
  });
  it("defaults an unrecognized/OTHER source to retail rather than dropping it", () => {
    expect(priceTypeForSource("OTHER")).toBe("retail");
  });
});

describe("normalizeManualCommodityEntry", () => {
  it("maps a manual AFEX entry's price_type via priceTypeForSource", () => {
    const normalized = normalizeManualCommodityEntry({
      entryDate: "2026-03-01",
      payload: {
        commodity: "Rice (paddy)",
        market: "National average",
        price: 345.32,
        unit: "kg",
        currency: "NGN",
        source: "AFEX",
      },
    });
    expect(normalized.priceType).toBe("exchange_spot");
    expect(normalized.value).toBe(345.32);
    expect(normalized.region).toBe("National average");
  });
});

describe("reconcileCommodityPrices", () => {
  it("averages two retail sources reporting the same commodity/unit/region", () => {
    const result = reconcileCommodityPrices([
      obs({ commodity: "Rice (paddy)", source: "NBS", value: 1200, periodDate: "2026-04-01" }),
      obs({ commodity: "Rice (paddy)", source: "WORLD_BANK_RTFP", value: 1300, periodDate: "2026-04-01" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].average).toBeCloseTo(1250);
    expect(result[0].observations).toHaveLength(2);
  });

  it("never averages a retail observation with an exchange_spot one, even for the same commodity", () => {
    const result = reconcileCommodityPrices([
      obs({ commodity: "Rice (paddy)", source: "NBS", priceType: "retail", value: 1200 }),
      obs({ commodity: "Rice (paddy)", source: "AFEX", priceType: "exchange_spot", value: 345, region: "National average" }),
    ]);
    expect(result).toHaveLength(2);
    for (const group of result) {
      expect(group.average).toBeNull();
      expect(group.observations).toHaveLength(1);
    }
  });

  it("leaves average null when only one source reports a commodity", () => {
    const result = reconcileCommodityPrices([obs({ commodity: "Yams", source: "NBS", value: 500 })]);
    expect(result).toHaveLength(1);
    expect(result[0].average).toBeNull();
  });

  it("keeps only the most recent observation per source within a group", () => {
    const result = reconcileCommodityPrices([
      obs({ commodity: "Maize", source: "NBS", value: 100, periodDate: "2026-01-01" }),
      obs({ commodity: "Maize", source: "NBS", value: 200, periodDate: "2026-03-01" }),
      obs({ commodity: "Maize", source: "WORLD_BANK_RTFP", value: 300, periodDate: "2026-02-01" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].observations).toHaveLength(2);
    const nbsObs = result[0].observations.find((o) => o.source === "NBS");
    expect(nbsObs?.value).toBe(200); // the March observation, not January's
    expect(result[0].average).toBeCloseTo(250); // (200 + 300) / 2
    expect(result[0].periodDate).toBe("2026-03-01");
  });

  it("never groups observations with different units together", () => {
    const result = reconcileCommodityPrices([
      obs({ commodity: "Sorghum", source: "NBS", value: 100, unit: "NGN per kg" }),
      obs({ commodity: "Sorghum", source: "WORLD_BANK_RTFP", value: 50000, unit: "NGN per tonne" }),
    ]);
    expect(result).toHaveLength(2);
    expect(result.every((g) => g.average === null)).toBe(true);
  });

  it("returns results sorted by commodity name", () => {
    const result = reconcileCommodityPrices([
      obs({ commodity: "Yams", source: "NBS", value: 500 }),
      obs({ commodity: "Cowpeas", source: "NBS", value: 700 }),
    ]);
    expect(result.map((g) => g.commodity)).toEqual(["Cowpeas", "Yams"]);
  });
});
