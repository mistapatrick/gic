import { describe, expect, it } from "vitest";
import {
  matchNbsItem,
  parseNbsHeaderPeriod,
  findNbsHeaderRow,
  parseNbsWorksheetRows,
  findAllNbsCatalogEntries,
  findLatestNbsCatalogEntry,
  type NbsCellValue,
} from "@/lib/domains/commodity-prices/nbs-ingest-logic";

describe("matchNbsItem", () => {
  it("matches known item label variants to a tracked commodity", () => {
    expect(matchNbsItem("Rice local sold loose 1kg")?.commodity).toBe("Rice (paddy)");
    expect(matchNbsItem("Yam tuber")?.commodity).toBe("Yams");
    expect(matchNbsItem("Beans brown (sold loose)")?.commodity).toBe("Cowpeas");
    expect(matchNbsItem("Beef boneless")?.commodity).toBe("Cattle meat");
  });
  it("returns null for an item NBS tracks that isn't one of GIC's 15 commodities", () => {
    expect(matchNbsItem("Garri white")).toBeNull();
    expect(matchNbsItem("Agric eggs medium size")).toBeNull();
  });
});

describe("parseNbsHeaderPeriod", () => {
  it("parses 'Mon-YY' and 'Month-YYYY' style headers", () => {
    expect(parseNbsHeaderPeriod("Apr-26")).toBe("2026-04-01");
    expect(parseNbsHeaderPeriod("February 2026")).toBe("2026-02-01");
  });
  it("returns null for non-date header cells", () => {
    expect(parseNbsHeaderPeriod("MoM")).toBeNull();
    expect(parseNbsHeaderPeriod("Highest")).toBeNull();
    expect(parseNbsHeaderPeriod(42)).toBeNull();
  });
});

describe("findNbsHeaderRow", () => {
  it("finds the first row with at least two recognizable month columns", () => {
    const rows: NbsCellValue[][] = [
      ["Selected Food Price Watch"],
      ["Items", "Feb-25", "Mar-25", "MoM", "YoY"],
      ["Yam tuber", 400, 420, 5, 10],
    ];
    const header = findNbsHeaderRow(rows);
    expect(header).not.toBeNull();
    expect(header?.rowIndex).toBe(1);
    expect(header?.periodsByColumn.get(1)).toBe("2025-02-01");
    expect(header?.periodsByColumn.get(2)).toBe("2025-03-01");
  });
  it("returns null when no row has two or more dated columns", () => {
    const rows: NbsCellValue[][] = [["Items", "Highest", "Lowest"]];
    expect(findNbsHeaderRow(rows)).toBeNull();
  });
});

describe("parseNbsWorksheetRows", () => {
  it("emits one observation per matched item per dated column", () => {
    const rows: NbsCellValue[][] = [
      ["Items", "Feb-25", "Mar-25"],
      ["Yam tuber", 400, 420],
      ["Garri white", 300, 310], // untracked — should be skipped
    ];
    const result = parseNbsWorksheetRows(rows, "2026-01-01");
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.commodity === "Yams")).toBe(true);
    expect(result.map((r) => r.value).sort()).toEqual([400, 420]);
    expect(result.map((r) => r.periodDate).sort()).toEqual(["2025-02-01", "2025-03-01"]);
    expect(result[0].source).toBe("NBS");
    expect(result[0].priceType).toBe("retail");
  });

  it("falls back to the provided period when no dated header row is found", () => {
    const rows: NbsCellValue[][] = [["Yam tuber", 450]];
    const result = parseNbsWorksheetRows(rows, "2026-05-01");
    expect(result).toHaveLength(1);
    expect(result[0].periodDate).toBe("2026-05-01");
    expect(result[0].value).toBe(450);
  });

  it("skips non-numeric and non-positive cells rather than writing a bad value", () => {
    const rows: NbsCellValue[][] = [
      ["Items", "Feb-25", "Mar-25"],
      ["Yam tuber", "N/A", -5],
    ];
    expect(parseNbsWorksheetRows(rows, "2026-01-01")).toHaveLength(0);
  });

  it("returns an empty array for an empty sheet", () => {
    expect(parseNbsWorksheetRows([], "2026-01-01")).toEqual([]);
  });
});

describe("findAllNbsCatalogEntries / findLatestNbsCatalogEntry", () => {
  const html = `
    <a href="/index.php/catalog/162/download/1365/Selected_Food_Report_Jan26.zip">January 2026</a>
    <a href="/index.php/catalog/162/download/1401/Selected_Food_Report_Mar_2026.zip">March 2026</a>
    <a href="/index.php/catalog/162/download/9999/some_unrelated_file.pdf">Not dated</a>
  `;

  it("extracts every dated entry with an absolute download URL", () => {
    const entries = findAllNbsCatalogEntries(html);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.downloadUrl.startsWith("https://microdata.nigerianstat.gov.ng"))).toBe(true);
  });

  it("findLatestNbsCatalogEntry picks the highest catalog id, not the latest-looking filename", () => {
    const latest = findLatestNbsCatalogEntry(html);
    expect(latest?.periodDate).toBe("2026-03-01");
  });

  it("returns null when the page has no recognizable dated entries", () => {
    expect(findLatestNbsCatalogEntry("<p>nothing here</p>")).toBeNull();
    expect(findAllNbsCatalogEntries("<p>nothing here</p>")).toEqual([]);
  });
});
