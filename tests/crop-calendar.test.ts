import { describe, it, expect } from "vitest";
import { CROP_CALENDAR } from "@/lib/domains/crop-calendar/calendar-data";
import { TRACKED_COMMODITIES } from "@/lib/domains/production-conditions/ingest-logic";
import { GEO_ZONES } from "@/lib/types";

describe("crop-calendar data", () => {
  it("has at least one entry for every one of the 6 geo-zones", () => {
    for (const zone of GEO_ZONES) {
      expect(CROP_CALENDAR[zone]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("every entry's commodity exists in TRACKED_COMMODITIES", () => {
    const trackedNames = new Set(TRACKED_COMMODITIES.map((c) => c.commodity));
    for (const entries of Object.values(CROP_CALENDAR)) {
      for (const entry of entries) {
        expect(trackedNames.has(entry.commodity)).toBe(true);
      }
    }
  });

  it("every entry has non-empty planting and harvest windows", () => {
    for (const entries of Object.values(CROP_CALENDAR)) {
      for (const entry of entries) {
        expect(entry.plantingWindow.length).toBeGreaterThan(0);
        expect(entry.harvestWindow.length).toBeGreaterThan(0);
      }
    }
  });

  it("excludes livestock commodities (no planting/harvest cycle)", () => {
    const allCommodities = Object.values(CROP_CALENDAR)
      .flat()
      .map((e) => e.commodity);
    expect(allCommodities).not.toContain("Cattle meat");
    expect(allCommodities).not.toContain("Cow milk");
  });
});
