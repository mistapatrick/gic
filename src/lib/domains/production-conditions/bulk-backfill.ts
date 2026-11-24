import "server-only";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import {
  FAOSTAT_AREA_CODE_NIGERIA,
  type ProductionConditionRow,
} from "@/lib/domains/production-conditions/ingest-logic";
import { parseBulkCsvRows, type BulkCsvRow } from "@/lib/domains/production-conditions/bulk-ingest-logic";
import { upsertProductionConditionRows } from "@/lib/domains/production-conditions/backfill";
import { GIC_OUTBOUND_HEADERS } from "@/lib/ingestion/outbound-headers";

/**
 * production_conditions' SECOND, independent path into FAOSTAT — the
 * static bulk-download file, alongside (not replacing) the live query API
 * in backfill.ts and route.ts. Added after the live query endpoint
 * returned HTTP 521 on three separate attempts against
 * fenixservices.fao.org, including after a timeout fix and an outbound
 * User-Agent fix, which pointed at that specific endpoint being
 * unreliable rather than anything about how this app was calling it.
 * FAOSTAT also publishes the same QCL domain as one static file per
 * release, served from a different host (bulks-faostat.fao.org) with no
 * live query parameters at all — a structurally different request that
 * plausibly sidesteps whatever is rejecting the live one.
 *
 * Same pattern as commodity_prices_worldbank_rtfp's backfill adapter:
 * ignores the chunk's date span entirely (the bulk file is one whole-
 * history download covering every year FAOSTAT has, not a per-year
 * query), ZIP-wrapped like NBS's monthly download, and feeds the same
 * production_conditions upsert as the live-query path via
 * upsertProductionConditionRows() in backfill.ts.
 */

const BULK_ZIP_URL =
  "https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_NOFLAG.zip";

/**
 * Downloads the bulk ZIP and returns its parsed CSV rows (csv-parse's
 * `columns: true` output — see bulk-ingest-logic.ts for what happens
 * next). Exported separately from fetchProductionConditionsBulkChunk so
 * the manual-upload route (which already has the ZIP or CSV bytes from
 * the admin's own upload, not a URL to fetch) can reuse the unzip+parse
 * half without also reusing the network fetch half.
 */
export function extractCsvRowsFromZipOrCsv(buffer: Buffer): BulkCsvRow[] {
  const looksLikeHtml = buffer.subarray(0, 200).toString("utf8").toLowerCase().includes("<html");
  if (looksLikeHtml) {
    throw new Error(
      "FAOSTAT bulk download returned an HTML page instead of a ZIP/CSV file — the bulk-download " +
        "URL may have changed, or the request was redirected to an error or sign-in page. Refusing " +
        "to parse it as data."
    );
  }

  // A ZIP file starts with the local-file-header signature "PK\x03\x04"
  // (or the empty-archive / spanned variants, all starting "PK"); anything
  // else is assumed to already be a raw CSV — this is what lets the
  // manual-upload route accept either a human-downloaded .zip or a .csv
  // someone unzipped themselves, without needing a file-extension check.
  const looksLikeZip = buffer.subarray(0, 2).toString("ascii") === "PK";

  let csvText: string;
  if (looksLikeZip) {
    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch (err) {
      throw new Error(
        `FAOSTAT bulk download was not a valid ZIP archive (${(err as Error).message}).`
      );
    }
    const csvEntry = zip.getEntries().find((entry) => entry.entryName.toLowerCase().endsWith(".csv"));
    if (!csvEntry) {
      throw new Error(
        "FAOSTAT bulk ZIP did not contain a .csv file — its contents don't match what this " +
          "ingestor expects, refusing to guess."
      );
    }
    csvText = csvEntry.getData().toString("utf8");
  } else {
    csvText = buffer.toString("utf8");
  }

  return parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as BulkCsvRow[];
}

export async function fetchProductionConditionsBulkChunk(): Promise<BulkCsvRow[]> {
  const res = await fetch(BULK_ZIP_URL, {
    cache: "no-store",
    // 45s, matching every other "big download" call in this codebase
    // (production_conditions' own live-query fetch, NBS's ZIP, World
    // Bank's CSV) and the route's own maxDuration = 60 budget — see
    // route.ts for why 60s is a hard ceiling here (Vercel Hobby/free
    // tier), not a value this app chose. This file is a whole-world,
    // whole-history export (every country, every year, one domain) —
    // meaningfully larger than any other single download in this
    // codebase — so 45s may not be enough; there is no live deployment
    // to measure it against from this sandbox. If this route's own
    // last_error ever shows a timeout here, that is real evidence this
    // guess was wrong, in which case the fix is almost certainly moving
    // this fetch+parse+write off the Vercel request/response cycle
    // entirely (e.g. running it directly on the GitHub Actions runner,
    // which has no 60s ceiling) rather than raising this number again —
    // the live-query route already went through two rounds of "raise the
    // timeout" before the real problem turned out to be the endpoint
    // itself, and a merely-bigger number has the same failure mode here
    // if the file is too large for a serverless function regardless of
    // how long it's allowed to run.
    signal: AbortSignal.timeout(45_000),
    headers: GIC_OUTBOUND_HEADERS,
  });
  if (!res.ok) {
    throw new Error(`FAOSTAT bulk download failed: HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return extractCsvRowsFromZipOrCsv(buffer);
}

export function parseProductionConditionsBulkChunk(rows: BulkCsvRow[]): ProductionConditionRow[] {
  return parseBulkCsvRows(rows, FAOSTAT_AREA_CODE_NIGERIA);
}

export async function writeProductionConditionsBulkChunk(rows: BulkCsvRow[]): Promise<number> {
  const parsed = parseProductionConditionsBulkChunk(rows);
  return upsertProductionConditionRows(parsed);
}
