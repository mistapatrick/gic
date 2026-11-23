import type { NormalizedPriceObservation } from "@/lib/domains/commodity-prices/price-types";

/**
 * Pure, side-effect-free parsing logic for NBS's "Selected Food Price
 * Watch" — factored out from the network/zip/xlsx-loading side (see
 * nbs-fetch.ts) exactly like every other domain's ingest-logic.ts, so it's
 * unit-tested with plain arrays, no live network/Supabase/zip/xlsx library
 * involved (see tests/nbs-ingest-logic.test.ts).
 *
 * IMPORTANT CAVEAT, read before trusting this on a live run: this build
 * environment could not download or open an actual NBS xlsx file — the
 * sandbox's own network allowlist blocks nigerianstat.gov.ng directly
 * (confirmed: a direct curl attempt got a 403 from the outbound proxy
 * before even reaching NBS), and the available web-fetch tooling can
 * summarize the page but not hand back the raw binary of a .zip/.xlsx. So
 * the row shape this parser expects (first non-empty cell = item label,
 * remaining cells = one or more "<Mon>-<YY>" dated columns) is a
 * best-effort inference from text excerpts of NBS's PDF reports, not a
 * confirmed xlsx layout. It throws a specific, loud error — not a silent
 * zero-row result — if a live file doesn't match this shape, so the very
 * first production run (see SECURITY.md) is effectively this parser's
 * real calibration step, the same role FAOSTAT's area code played for
 * production_conditions.
 */

export interface NbsItemVariant {
  commodity: string;
  labelContains: string[];
}

/**
 * Deliberately conservative: only commodities NBS's own published report
 * excerpts actually evidenced (rice, yam, brown beans, beef) are matched.
 * The other 11 of GIC's 15 tracked commodities (maize, sorghum, millet,
 * cassava, groundnuts, soya beans, cocoa beans, oil palm fruit, seed
 * cotton, sesame seed, cow milk) are NOT in NBS's "Selected Food Price
 * Watch" consumer-retail basket as far as this research could confirm —
 * rather than guess a match with no evidence, this domain simply won't
 * have an NBS figure for those commodities, which is visible as "no NBS
 * observation" rather than a wrong one. Confirm the full item list against
 * a real downloaded report and extend this table once it's available.
 *
 * NBS's retail items are also a different product stage than
 * production_conditions' raw-commodity labels (e.g. "Rice local sold
 * loose" is MILLED retail rice, not FAOSTAT's raw paddy rice) — the GIC
 * commodity label is kept the same across domains for cross-navigation,
 * but rawItemLabel preserves exactly what NBS measured so this distinction
 * is never hidden from a reader.
 */
export const NBS_ITEM_VARIANTS: NbsItemVariant[] = [
  { commodity: "Rice (paddy)", labelContains: ["rice local", "rice, local", "rice (local)"] },
  { commodity: "Yams", labelContains: ["yam tuber", "yam (tuber)"] },
  { commodity: "Cowpeas", labelContains: ["beans brown", "beans, brown", "brown beans"] },
  { commodity: "Cattle meat", labelContains: ["beef"] },
];

export function matchNbsItem(label: string): NbsItemVariant | null {
  const lower = label.toLowerCase().trim();
  return NBS_ITEM_VARIANTS.find((v) => v.labelContains.some((c) => lower.includes(c))) ?? null;
}

const MONTH_NUMBERS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Parses a header cell like "Apr-26", "April-2026", "April 2026" into a
 * "YYYY-MM-01" period date. Returns null for anything that isn't
 * recognizably a month label (e.g. "MoM", "Highest", the item-label
 * column's own header).
 */
export function parseNbsHeaderPeriod(cell: unknown): string | null {
  if (typeof cell !== "string") return null;
  const match = cell.trim().toLowerCase().match(/^([a-z]{3,9})[\s-]?(\d{2}|\d{4})$/);
  if (!match) return null;
  const monthKey = match[1].slice(0, 3);
  const monthNum = MONTH_NUMBERS[monthKey];
  if (!monthNum) return null;
  let year = match[2];
  if (year.length === 2) year = `20${year}`;
  return `${year}-${monthNum}-01`;
}

export type NbsCellValue = string | number | null | undefined;

/**
 * Finds the header row: the first row (scanning at most the first 5, to
 * tolerate a title row or two above it) with at least two cells that
 * parse as a month period via parseNbsHeaderPeriod. Returns the row index
 * and a map of column index -> period date for every dated column found.
 */
export function findNbsHeaderRow(
  rows: NbsCellValue[][]
): { rowIndex: number; periodsByColumn: Map<number, string> } | null {
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const periodsByColumn = new Map<number, string>();
    rows[r].forEach((cell, colIndex) => {
      const period = parseNbsHeaderPeriod(cell);
      if (period) periodsByColumn.set(colIndex, period);
    });
    if (periodsByColumn.size >= 2) {
      return { rowIndex: r, periodsByColumn };
    }
  }
  return null;
}

/**
 * Parses a worksheet already reduced to a plain 2D array of cell values
 * (the fetch/backfill layer does the exceljs loading and hands this
 * function plain rows — see nbs-fetch.ts) into normalized price
 * observations: one per (matched item row) x (dated column).
 *
 * fallbackPeriodDate is used only if no header row with recognizable
 * month columns is found — in that case the whole sheet is treated as a
 * single snapshot for the month the ZIP itself was published for (known
 * by the fetch layer from the catalog page, not from the file's own
 * content).
 */
export function parseNbsWorksheetRows(
  rows: NbsCellValue[][],
  fallbackPeriodDate: string
): NormalizedPriceObservation[] {
  if (rows.length === 0) return [];

  const header = findNbsHeaderRow(rows);
  const results: NormalizedPriceObservation[] = [];

  const dataStartRow = header ? header.rowIndex + 1 : 0;

  for (let r = dataStartRow; r < rows.length; r++) {
    const row = rows[r];
    const labelCell = row.find((c) => typeof c === "string" && c.trim().length > 0);
    if (!labelCell || typeof labelCell !== "string") continue;

    const matched = matchNbsItem(labelCell);
    if (!matched) continue;

    if (header) {
      for (const [colIndex, periodDate] of header.periodsByColumn) {
        const raw = row[colIndex];
        const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
        if (!Number.isFinite(value) || value <= 0) continue;
        results.push({
          commodity: matched.commodity,
          source: "NBS",
          priceType: "retail",
          value,
          unit: "NGN per kg",
          currency: "NGN",
          periodDate,
          region: "National",
          rawItemLabel: labelCell.trim(),
        });
      }
    } else {
      // No recognizable dated header — take the first numeric cell in the
      // row as this month's figure, under the fallback period.
      const numericCell = row.find(
        (c) => (typeof c === "number" && Number.isFinite(c)) ||
          (typeof c === "string" && Number.isFinite(Number(c)) && c.trim().length > 0)
      );
      if (numericCell === undefined) continue;
      const value = typeof numericCell === "number" ? numericCell : Number(numericCell);
      if (!Number.isFinite(value) || value <= 0) continue;
      results.push({
        commodity: matched.commodity,
        source: "NBS",
        priceType: "retail",
        value,
        unit: "NGN per kg",
        currency: "NGN",
        periodDate: fallbackPeriodDate,
        region: "National",
        rawItemLabel: labelCell.trim(),
      });
    }
  }

  return results;
}

export interface NbsCatalogEntry {
  downloadUrl: string;
  periodDate: string;
  id: number;
}

/**
 * Extracts every dated catalog entry (id + direct download URL + the
 * period it covers) from the NBS microdata catalog page's raw HTML. Pure
 * string/regex logic — the fetch layer (nbs-backfill.ts) hands this the
 * page text it already retrieved, for both the steady-state weekly cron
 * (which only wants the latest) and historical backfill (which wants
 * every entry falling in a given chunk's date span).
 */
export function findAllNbsCatalogEntries(catalogHtml: string): NbsCatalogEntry[] {
  // Matches hrefs like
  // /index.php/catalog/162/download/1427/Selected_Food_Report_May%2026.zip
  const linkPattern =
    /href=["']([^"']*\/catalog\/162\/download\/(\d+)\/[^"']*\.(?:zip|xlsx)[^"']*)["']/gi;
  const entries: NbsCatalogEntry[] = [];

  for (const match of catalogHtml.matchAll(linkPattern)) {
    const [, relativeOrAbsoluteUrl, idStr] = match;
    const id = Number(idStr);
    // The filename itself usually carries the month/year
    // ("Selected_Food_Report_May_2026.zip", "..._May26.zip", "...Mar_2026.zip")
    const filenameMatch = relativeOrAbsoluteUrl.match(
      /([A-Za-z]{3,9})[_\s]?(\d{2,4})\.(?:zip|xlsx)/i
    );
    const periodDate = filenameMatch ? parseNbsHeaderPeriod(`${filenameMatch[1]}-${filenameMatch[2]}`) : null;
    if (!periodDate) continue;
    const downloadUrl = relativeOrAbsoluteUrl.startsWith("http")
      ? relativeOrAbsoluteUrl
      : `https://microdata.nigerianstat.gov.ng${relativeOrAbsoluteUrl}`;
    entries.push({ downloadUrl, periodDate, id });
  }

  return entries;
}

/**
 * The single most recent entry — what the steady-state weekly cron uses.
 */
export function findLatestNbsCatalogEntry(
  catalogHtml: string
): { downloadUrl: string; periodDate: string } | null {
  const entries = findAllNbsCatalogEntries(catalogHtml);
  if (entries.length === 0) return null;
  const best = entries.reduce((a, b) => (b.id > a.id ? b : a));
  return { downloadUrl: best.downloadUrl, periodDate: best.periodDate };
}
