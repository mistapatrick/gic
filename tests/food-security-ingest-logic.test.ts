import { describe, expect, it } from "vitest";
import { parseFoodSecurityRecords } from "@/lib/domains/food-security/ingest-logic";

describe("parseFoodSecurityRecords", () => {
  const baseRow = {
    location_code: "NGA",
    location_name: "Nigeria",
    admin_level: "1",
    admin1_code: "NG008",
    admin1_name: "Borno",
    admin2_code: "",
    admin2_name: "",
    ipc_phase: "3",
    ipc_type: "current",
    population_in_phase: "150000",
    population_fraction_in_phase: "0.12",
    reference_period_start: "2026-06-01T00:00:00",
    reference_period_end: "2026-08-31T00:00:00",
    resource_hdx_id: "abc-123",
  };

  it("parses a well-formed Nigeria row", () => {
    const result = parseFoodSecurityRecords([baseRow]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      locationCode: "NGA",
      admin1Name: "Borno",
      ipcPhase: "3",
      ipcType: "current",
      populationInPhase: 150000,
      populationFractionInPhase: 0.12,
      referencePeriodStart: "2026-06-01",
      referencePeriodEnd: "2026-08-31",
      resourceHdxId: "abc-123",
    });
  });

  it("filters out non-Nigeria rows", () => {
    const result = parseFoodSecurityRecords([baseRow, { ...baseRow, location_code: "NER" }]);
    expect(result).toHaveLength(1);
  });

  it("matches location_code case-insensitively", () => {
    const result = parseFoodSecurityRecords([{ ...baseRow, location_code: "nga" }]);
    expect(result).toHaveLength(1);
  });

  it("skips an individual row with an empty reference period, without rejecting the whole response", () => {
    const badRow = { ...baseRow, reference_period_start: "" };
    const result = parseFoodSecurityRecords([baseRow, badRow]);
    expect(result).toHaveLength(1);
  });

  it("defaults locationName and adminLevel when absent, and nulls out missing population figures", () => {
    const { location_name: _n, admin_level: _l, population_in_phase: _p, ...rest } = baseRow;
    void _n;
    void _l;
    void _p;
    const result = parseFoodSecurityRecords([rest]);
    expect(result[0].locationName).toBe("Nigeria");
    expect(result[0].adminLevel).toBe("0");
    expect(result[0].populationInPhase).toBeNull();
  });

  it("throws when a required field is missing from the response shape entirely", () => {
    expect(() => parseFoodSecurityRecords([{ location_code: "NGA" }])).toThrow(/missing expected field/i);
  });

  it("returns an empty array for no records", () => {
    expect(parseFoodSecurityRecords([])).toEqual([]);
  });
});
