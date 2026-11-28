import { describe, expect, it } from "vitest";
import {
  getProductionConditionsResolutionHorizon,
  getCommodityPricesResolutionHorizon,
} from "@/lib/scenarios/resolution-horizon";

describe("getProductionConditionsResolutionHorizon", () => {
  it("describes the next FAOSTAT annual release", () => {
    const horizon = getProductionConditionsResolutionHorizon(new Date("2026-11-27T00:00:00Z"));
    expect(horizon.description).toBe("the next FAOSTAT annual release");
  });

  it("targets December 31st of the year after the generation year", () => {
    const horizon = getProductionConditionsResolutionHorizon(new Date("2026-11-27T00:00:00Z"));
    expect(horizon.targetResolutionDate).toBe("2027-12-31");
  });

  it("still targets next year even when generated early in the year", () => {
    const horizon = getProductionConditionsResolutionHorizon(new Date("2026-01-02T00:00:00Z"));
    expect(horizon.targetResolutionDate).toBe("2027-12-31");
  });

  it("rolls over correctly across a year boundary", () => {
    const horizon = getProductionConditionsResolutionHorizon(new Date("2026-12-31T23:59:59Z"));
    expect(horizon.targetResolutionDate).toBe("2027-12-31");
  });
});

describe("getCommodityPricesResolutionHorizon", () => {
  it("describes the next NBS/World Bank RTFP price print", () => {
    const horizon = getCommodityPricesResolutionHorizon(new Date("2026-11-27T00:00:00Z"));
    expect(horizon.description).toContain("NBS/World Bank RTFP");
    expect(horizon.description).toContain("2-3 weeks");
  });

  it("targets 21 days out", () => {
    const horizon = getCommodityPricesResolutionHorizon(new Date("2026-11-27T00:00:00Z"));
    expect(horizon.targetResolutionDate).toBe("2026-12-18");
  });

  it("rolls over a month boundary correctly", () => {
    const horizon = getCommodityPricesResolutionHorizon(new Date("2026-12-20T00:00:00Z"));
    expect(horizon.targetResolutionDate).toBe("2027-01-10");
  });
});
