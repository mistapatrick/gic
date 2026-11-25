import { describe, expect, it } from "vitest";
import {
  buildCompactProductionTelemetry,
  buildProductionBriefPrompt,
  type ProductionBriefRow,
} from "@/lib/domains/production-conditions/brief-logic";
import { getCropCategory, getCropEmoji } from "@/lib/domains/production-conditions/crop-emoji";

describe("buildCompactProductionTelemetry", () => {
  it("groups rows by commodity and labels each metric", () => {
    const rows: ProductionBriefRow[] = [
      { commodity: "Maize", metric: "production_quantity", value: 12_000_000, unit: "t", year: 2023 },
      { commodity: "Maize", metric: "yield", value: 1.8, unit: "t/ha", year: 2023 },
    ];
    const text = buildCompactProductionTelemetry(rows);
    expect(text).toContain("Maize:");
    expect(text).toContain("production 12,000,000 t (2023)");
    expect(text).toContain("yield 1.8 t/ha (2023)");
  });

  it("keeps at most the two most recent years per metric, newest first", () => {
    const rows: ProductionBriefRow[] = [
      { commodity: "Sorghum", metric: "production_quantity", value: 100, unit: "t", year: 2020 },
      { commodity: "Sorghum", metric: "production_quantity", value: 200, unit: "t", year: 2022 },
      { commodity: "Sorghum", metric: "production_quantity", value: 300, unit: "t", year: 2023 },
    ];
    const text = buildCompactProductionTelemetry(rows);
    expect(text).toContain("300 t (2023), 200 t (2022)");
    expect(text).not.toContain("100 t (2020)");
  });

  it("handles multiple commodities independently", () => {
    const rows: ProductionBriefRow[] = [
      { commodity: "Maize", metric: "production_quantity", value: 1, unit: "t", year: 2023 },
      { commodity: "Cassava", metric: "production_quantity", value: 2, unit: "t", year: 2023 },
    ];
    const text = buildCompactProductionTelemetry(rows);
    expect(text).toContain("Maize:");
    expect(text).toContain("Cassava:");
  });

  it("returns an empty string for no rows", () => {
    expect(buildCompactProductionTelemetry([])).toBe("");
  });
});

describe("buildProductionBriefPrompt", () => {
  it("embeds the compact telemetry text in the prompt", () => {
    const prompt = buildProductionBriefPrompt("Maize: production 1 t (2023)");
    expect(prompt).toContain("Maize: production 1 t (2023)");
    expect(prompt.toLowerCase()).toContain("never invent");
  });
});

describe("getCropEmoji", () => {
  it("returns a mapped emoji for a tracked commodity", () => {
    expect(getCropEmoji("Maize")).toBe("\u{1F33D}");
  });
  it("falls back to a default emoji for an unmapped commodity", () => {
    expect(getCropEmoji("Quinoa")).toBe("\u{1F331}");
  });
});

describe("getCropCategory", () => {
  it("categorizes known commodities", () => {
    expect(getCropCategory("Maize")).toBe("Cereals");
    expect(getCropCategory("Cassava")).toBe("Roots & tubers");
    expect(getCropCategory("Cattle meat")).toBe("Livestock products");
  });
  it("falls back to Other for an unmapped commodity", () => {
    expect(getCropCategory("Quinoa")).toBe("Other");
  });
});
