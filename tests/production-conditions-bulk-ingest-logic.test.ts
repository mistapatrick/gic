import { describe, expect, it } from "vitest";
import {
  detectBulkCsvShape,
  parseBulkCsvRows,
  type BulkCsvRow,
} from "@/lib/domains/production-conditions/bulk-ingest-logic";
import { FAOSTAT_AREA_CODE_NIGERIA } from "@/lib/domains/production-conditions/ingest-logic";

describe("detectBulkCsvShape", () => {
  it("detects the wide layout from Y#### columns", () => {
    const row: BulkCsvRow = {
      "Area Code": "159",
      Area: "Nigeria",
      Item: "Maize (corn)",
      Element: "Production",
      Unit: "t",
      Y2022: "11000000",
      Y2023: "12000000",
    };
    const detected = detectBulkCsvShape(row);
    expect(detected.shape).toBe("wide");
    expect(detected.yearColumns).toEqual(
      expect.arrayContaining([
        { column: "Y2022", year: 2022 },
        { column: "Y2023", year: 2023 },
      ])
    );
  });

  it("detects the long layout from a Year column", () => {
    const row: BulkCsvRow = {
      "Area Code": "159",
      Area: "Nigeria",
      Item: "Maize (corn)",
      Element: "Production",
      Unit: "t",
      Year: "2023",
      Value: "12000000",
    };
    expect(detectBulkCsvShape(row).shape).toBe("long");
  });

  it("throws a specific error when neither layout matches", () => {
    const row: BulkCsvRow = { Foo: "bar", Baz: "qux" };
    expect(() => detectBulkCsvShape(row)).toThrow(/did not match either known layout/);
  });
});

describe("parseBulkCsvRows — wide layout", () => {
  const wideRow = (overrides: Partial<BulkCsvRow> = {}): BulkCsvRow => ({
    "Area Code": "159",
    Area: "Nigeria",
    "Item Code": "56",
    Item: "Maize (corn)",
    "Element Code": "5510",
    Element: "Production",
    Unit: "t",
    Y2022: "11000000",
    Y2023: "12000000",
    ...overrides,
  });

  it("expands year columns into one row per year", () => {
    const rows = parseBulkCsvRows([wideRow()], FAOSTAT_AREA_CODE_NIGERIA);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.year === 2023)?.value).toBe(12_000_000);
    expect(rows.find((r) => r.year === 2022)?.value).toBe(11_000_000);
    expect(rows[0]).toMatchObject({ commodity: "Maize", metric: "production_quantity", region: "National", source: "FAOSTAT" });
  });

  it("skips other countries without error", () => {
    const rows = parseBulkCsvRows(
      [wideRow(), wideRow({ "Area Code": "231", Area: "United States of America" })],
      FAOSTAT_AREA_CODE_NIGERIA
    );
    expect(rows).toHaveLength(2); // only Nigeria's two years, US row skipped
  });

  it("skips untracked commodities and elements", () => {
    const rows = parseBulkCsvRows(
      [wideRow({ Item: "Bananas" }), wideRow({ Element: "Stocks" })],
      FAOSTAT_AREA_CODE_NIGERIA
    );
    expect(rows).toHaveLength(0);
  });

  it("skips blank/missing year values without error", () => {
    const rows = parseBulkCsvRows([wideRow({ Y2022: "", Y2023: "12000000" })], FAOSTAT_AREA_CODE_NIGERIA);
    expect(rows).toHaveLength(1);
    expect(rows[0].year).toBe(2023);
  });

  it("throws when a row's area code and area name disagree", () => {
    expect(() =>
      parseBulkCsvRows([wideRow({ "Area Code": "159", Area: "Ghana" })], FAOSTAT_AREA_CODE_NIGERIA)
    ).toThrow(/Area Code 159 but Area "Ghana"/);
  });

  it("throws when no Nigeria rows are present at all", () => {
    expect(() =>
      parseBulkCsvRows([wideRow({ "Area Code": "231", Area: "United States of America" })], FAOSTAT_AREA_CODE_NIGERIA)
    ).toThrow(/contained no rows for Nigeria/);
  });

  it("throws when given zero rows", () => {
    expect(() => parseBulkCsvRows([], FAOSTAT_AREA_CODE_NIGERIA)).toThrow(/no data rows/);
  });
});

describe("parseBulkCsvRows — long layout", () => {
  it("parses a long-format row the same way as the wide one", () => {
    const row: BulkCsvRow = {
      "Area Code": "159",
      Area: "Nigeria",
      "Item Code": "56",
      Item: "Maize (corn)",
      "Element Code": "5510",
      Element: "Production",
      Unit: "t",
      Year: "2023",
      Value: "12000000",
    };
    const rows = parseBulkCsvRows([row], FAOSTAT_AREA_CODE_NIGERIA);
    expect(rows).toEqual([
      {
        commodity: "Maize",
        metric: "production_quantity",
        value: 12_000_000,
        unit: "t",
        year: 2023,
        region: "National",
        source: "FAOSTAT",
        faostat_area_code: 159,
        faostat_item_code: 56,
        faostat_element_code: 5510,
      },
    ]);
  });
});
