import {
  matchCommodity,
  matchMetric,
  type ProductionConditionRow,
} from "@/lib/domains/production-conditions/ingest-logic";

/**
 * Pure, side-effect-free parsing for FAOSTAT's static bulk-download file
 * (e.g. Production_Crops_Livestock_E_All_Data_NOFLAG.csv, from
 * https://bulks-faostat.fao.org/production/) — the second, independent
 * path into production_conditions alongside the live query API in
 * ingest-logic.ts. See bulk-backfill.ts for the fetch/unzip side and
 * src/app/api/admin/production-conditions/bulk-upload/route.ts for the
 * manual-upload side; both call into this same parser so there is exactly
 * one place that understands the bulk file's row shape.
 *
 * Why this file exists rather than reusing parseFaostatRecords: FAOSTAT's
 * live JSON API returns "long" rows (one row per Area+Item+Element+Year),
 * but its bulk CSV download is published "wide" — one row per
 * Area+Item+Element, with every year as its own column (Y1961, Y1962, ...,
 * Y2024, ...). This could not be independently confirmed against a live
 * download from this build environment (bulks-faostat.fao.org could not be
 * reached for verification, the same sandbox limitation already noted
 * against FAOSTAT_AREA_CODE_NIGERIA) — it is standard, long-documented
 * FAOSTAT bulk-export structure, not a guess invented for this file, but
 * it is still unconfirmed against a real response. Rather than silently
 * assume it and mis-parse (or silently write nothing), detectBulkCsvShape
 * below checks for the wide year-column pattern FIRST and the long
 * "Year" column SECOND, and throws a specific, actionable error if
 * neither is present — so a live run either works or fails loudly with a
 * message naming exactly what didn't match, the same "confirm on first
 * live run" posture already used throughout this domain.
 */

const EXPECTED_AREA_NAME = "nigeria";
const YEAR_COLUMN_PATTERN = /^Y(\d{4})$/;
const BULK_ZIP_URL_PATTERN = /https:\/\/bulks-faostat\.fao\.org\/[^"'\s\\]+\.zip/g;

/**
 * Pulls the current, real download URL out of FAOSTAT's own bulk-downloads
 * catalog response (GET https://fenixservices.fao.org/faostat/api/v1/en/
 * bulkdownloads/{domainCode} — documented in the R `FAOSTAT` package's own
 * source as `get_fao(paste0("/bulkdownloads/", dataset_code))`, and in
 * third-party API profiles as returning each file's "Full URL for
 * downloading the ZIP file").
 *
 * This exists because the first version of bulk-backfill.ts hardcoded a
 * filename found via a third-party documentation site rather than FAOSTAT's
 * own catalog — and the live run's first real HTTP 403 against that
 * hardcoded URL is exactly the failure mode a stale or wrong filename would
 * produce. Rather than hardcode a second guess, this scans the catalog
 * response text for any bulks-faostat.fao.org .zip URL, which is robust to
 * not knowing that response's exact JSON field names (never confirmed from
 * this sandbox either) — as long as the real URL appears as a string
 * somewhere in the response, which a "list of downloadable files" catalog
 * will always contain.
 *
 * Prefers a URL containing "NOFLAG" (the flag-stripped variant this
 * parser's column detection was built against) when more than one file is
 * listed for the domain; falls back to the first match otherwise.
 */
export function extractBulkDownloadUrl(catalogResponseText: string): string {
  const matches = catalogResponseText.match(BULK_ZIP_URL_PATTERN) ?? [];
  if (matches.length === 0) {
    throw new Error(
      "FAOSTAT's bulk-downloads catalog response contained no recognizable " +
        "bulks-faostat.fao.org .zip URL — its response shape may differ from what this parser " +
        `expects. First 500 characters of the response: ${catalogResponseText.slice(0, 500)}`
    );
  }
  // matches[0] is safe here: the length check above already guarantees at
  // least one element, but TS's noUncheckedIndexedAccess can't see that
  // across the earlier early-return.
  return matches.find((u) => u.includes("NOFLAG")) ?? matches[0]!;
}

export type BulkCsvShape = "wide" | "long";

export interface DetectedBulkShape {
  shape: BulkCsvShape;
  yearColumns?: Array<{ column: string; year: number }>; // only for "wide"
}

/**
 * A bulk CSV row as csv-parse's `columns: true` mode returns it: every
 * cell is a string (CSV has no native numeric type), keyed by header name.
 * Extra/unexpected columns (Flag, Note, …) are tolerated and ignored —
 * mirrors FaostatRecordSchema's .passthrough() in ingest-logic.ts.
 */
export type BulkCsvRow = Record<string, string>;

/**
 * Inspects the parsed header set (the keys of the first row) and works out
 * which of FAOSTAT's two bulk-export layouts this file uses. Checked
 * against the header set rather than assumed from the filename, since a
 * human using the manual-upload path could hand this parser either the
 * NOFLAG wide file or, if FAOSTAT's own download page changes, a
 * differently-shaped export.
 */
export function detectBulkCsvShape(headerRow: BulkCsvRow): DetectedBulkShape {
  const columns = Object.keys(headerRow);

  const yearColumns = columns
    .map((column) => {
      const match = column.match(YEAR_COLUMN_PATTERN);
      return match ? { column, year: Number(match[1]) } : null;
    })
    .filter((c): c is { column: string; year: number } => c !== null);

  if (yearColumns.length > 0) {
    return { shape: "wide", yearColumns };
  }

  if (columns.includes("Year")) {
    return { shape: "long" };
  }

  throw new Error(
    "FAOSTAT bulk CSV did not match either known layout — no Y#### year columns and no " +
      `"Year" column found. Columns present: ${columns.join(", ")}. The file's structure may ` +
      "have changed since this parser was written; it needs a corresponding update before this " +
      "file can be trusted."
  );
}

interface RawCell {
  areaName: string;
  areaCode: number | null;
  itemName: string;
  itemCode: number | null;
  elementName: string;
  elementCode: number | null;
  unit: string;
  year: number;
  value: number | null;
}

function toNumberOrNull(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw.replaceAll(",", ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Expands every row into one RawCell per year column (wide) or takes the
 * row as-is (long) — after this step, both layouts feed the same
 * downstream filtering, so everything below (Nigeria check, commodity/
 * metric matching) is written once regardless of which shape the source
 * file used.
 */
function* iterateRawCells(rows: BulkCsvRow[], detected: DetectedBulkShape): Generator<RawCell> {
  for (const row of rows) {
    const areaName = row.Area ?? "";
    const areaCode = toNumberOrNull(row["Area Code"]);
    const itemName = row.Item ?? "";
    const itemCode = toNumberOrNull(row["Item Code"]);
    const elementName = row.Element ?? "";
    const elementCode = toNumberOrNull(row["Element Code"]);
    const unit = row.Unit ?? row["Unit Name"] ?? "";

    if (detected.shape === "wide") {
      for (const { column, year } of detected.yearColumns ?? []) {
        yield {
          areaName,
          areaCode,
          itemName,
          itemCode,
          elementName,
          elementCode,
          unit,
          year,
          value: toNumberOrNull(row[column]),
        };
      }
    } else {
      yield {
        areaName,
        areaCode,
        itemName,
        itemCode,
        elementName,
        elementCode,
        unit,
        year: toNumberOrNull(row.Year) ?? Number.NaN,
        value: toNumberOrNull(row.Value),
      };
    }
  }
}

/**
 * Parses an already-CSV-decoded array of rows (csv-parse's `columns: true`
 * output) into ProductionConditionRow[], filtered to `expectedAreaName`
 * (Nigeria) and GIC's tracked commodities/metrics — the bulk-file
 * equivalent of parseFaostatRecords in ingest-logic.ts, reusing that
 * file's matchCommodity/matchMetric unchanged since both operate on
 * Item/Element names, which don't differ between the two FAOSTAT exports.
 *
 * Unlike parseFaostatRecords (which can throw on an unexpected Area
 * because every row it receives was already filtered server-side by
 * `?area=159`), this parser receives EVERY country in one file — rows for
 * other countries are expected and silently skipped, not an error. The
 * loud "wrong area code" failure mode only applies when NO Nigeria rows
 * are found at all, which would mean the area-code filter below is wrong,
 * not that some other country's data leaked in.
 */
export function parseBulkCsvRows(rows: BulkCsvRow[], expectedAreaCode: number): ProductionConditionRow[] {
  if (rows.length === 0) {
    throw new Error("FAOSTAT bulk CSV had no data rows to parse.");
  }

  const detected = detectBulkCsvShape(rows[0]);
  const out: ProductionConditionRow[] = [];
  let sawNigeriaByCode = false;
  let sawNigeriaByName = false;

  for (const cell of iterateRawCells(rows, detected)) {
    const isNigeriaByCode = cell.areaCode === expectedAreaCode;
    const isNigeriaByName = cell.areaName.trim().toLowerCase() === EXPECTED_AREA_NAME;
    if (!isNigeriaByCode && !isNigeriaByName) continue;

    if (isNigeriaByCode) sawNigeriaByCode = true;
    if (isNigeriaByName) sawNigeriaByName = true;

    // A row matching one signal but not the other means the area-code
    // constant and the human-readable name have drifted apart in this
    // file — exactly the mismatch parseFaostatRecords already guards
    // against for the live API, applied here too rather than silently
    // trusting whichever signal happened to match.
    if (isNigeriaByCode !== isNigeriaByName && cell.areaCode !== null) {
      throw new Error(
        `FAOSTAT bulk row has Area Code ${cell.areaCode} but Area "${cell.areaName}" — ` +
          `expected area code ${expectedAreaCode} to mean Nigeria. Refusing to ingest this batch.`
      );
    }

    if (cell.value === null || !Number.isFinite(cell.value)) continue; // no figure published for this year
    if (!Number.isFinite(cell.year)) continue;

    const commodity = matchCommodity(cell.itemName);
    if (!commodity) continue;

    const metric = matchMetric(cell.elementName);
    if (!metric) continue;

    out.push({
      commodity,
      metric,
      value: cell.value,
      unit: cell.unit,
      year: cell.year,
      region: "National",
      source: "FAOSTAT",
      faostat_area_code: cell.areaCode ?? expectedAreaCode,
      faostat_item_code: cell.itemCode,
      faostat_element_code: cell.elementCode,
    });
  }

  if (!sawNigeriaByCode && !sawNigeriaByName) {
    throw new Error(
      `FAOSTAT bulk CSV contained no rows for Nigeria (area code ${expectedAreaCode} or Area name ` +
        '"Nigeria") out of all countries in the file — the area-code constant may be wrong, or the ' +
        "file's country coverage changed. Refusing to report zero rows written as if this were a " +
        "normal empty release."
    );
  }

  return out;
}
