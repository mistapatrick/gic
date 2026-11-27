import { describe, expect, it } from "vitest";
import {
  detectBulkCsvShape,
  parseBulkCsvRows,
  parseBulkCsvRowsWithDiagnostics,
  extractBulkDownloadUrl,
  type BulkCsvRow,
} from "@/lib/domains/production-conditions/bulk-ingest-logic";
import { FAOSTAT_AREA_CODE_NIGERIA } from "@/lib/domains/production-conditions/ingest-logic";

describe("extractBulkDownloadUrl", () => {
  it("extracts a single matching URL from a JSON-shaped catalog response", () => {
    const response = JSON.stringify({
      data: [
        {
          FileName: "Production_Crops_Livestock_E_All_Data_NOFLAG.zip",
          URL: "https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_NOFLAG.zip",
          DateUpdate: "2026-02-25",
        },
      ],
    });
    expect(extractBulkDownloadUrl(response)).toBe(
      "https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_NOFLAG.zip"
    );
  });

  it("prefers a NOFLAG url when multiple files are listed", () => {
    const response = JSON.stringify({
      data: [
        { URL: "https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data.zip" },
        { URL: "https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_NOFLAG.zip" },
      ],
    });
    expect(extractBulkDownloadUrl(response)).toContain("NOFLAG");
  });

  it("falls back to the first match when no NOFLAG url is present", () => {
    const response = `{"url":"https://bulks-faostat.fao.org/production/Something_E_All_Data.zip"}`;
    expect(extractBulkDownloadUrl(response)).toBe(
      "https://bulks-faostat.fao.org/production/Something_E_All_Data.zip"
    );
  });

  it("throws a specific error naming the response when no url is found", () => {
    expect(() => extractBulkDownloadUrl('{"error":"not found"}')).toThrow(
      /contained no recognizable/
    );
  });
});

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
      [wideRow({ Item: "Sugar cane" }), wideRow({ Element: "Prices" })],
      FAOSTAT_AREA_CODE_NIGERIA
    );
    expect(rows).toHaveLength(0);
  });

  it("reports which untracked item names were skipped, and how often, via the diagnostics entry point", () => {
    // wideRow() defaults expand to 2 years (Y2022, Y2023), so one row with
    // an untracked Item should count as 2 skipped cells, not 1.
    const { rows, skippedCommodities } = parseBulkCsvRowsWithDiagnostics(
      [wideRow({ Item: "Sugar cane" }), wideRow({ Item: "Sorghum" })],
      FAOSTAT_AREA_CODE_NIGERIA
    );
    expect(rows).toHaveLength(2); // only the tracked Sorghum rows
    expect(skippedCommodities).toEqual([{ itemName: "Sugar cane", count: 2 }]);
  });

  it("does not report a skip for a row dropped only for its untracked Element (commodity itself matched)", () => {
    const { skippedCommodities } = parseBulkCsvRowsWithDiagnostics(
      [wideRow({ Element: "Prices" })], // "Maize (corn)" is tracked; "Prices" is not
      FAOSTAT_AREA_CODE_NIGERIA
    );
    expect(skippedCommodities).toEqual([]);
  });

  it("tracks the livestock-only Stocks and Producing Animals/Slaughtered elements", () => {
    const rows = parseBulkCsvRows(
      [
        wideRow({ Item: "Meat of cattle with the bone, fresh or chilled", Element: "Stocks" }),
        wideRow({
          Item: "Meat of cattle with the bone, fresh or chilled",
          Element: "Producing Animals/Slaughtered",
        }),
      ],
      FAOSTAT_AREA_CODE_NIGERIA
    );
    const metrics = new Set(rows.map((r) => r.metric));
    expect(metrics).toEqual(new Set(["stocks", "producing_animals_slaughtered"]));
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
