import "server-only";
import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import {
  findAllNbsCatalogEntries,
  parseNbsWorksheetRows,
  type NbsCellValue,
} from "@/lib/domains/commodity-prices/nbs-ingest-logic";
import type { NormalizedPriceObservation } from "@/lib/domains/commodity-prices/price-types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * NBS Selected Food Price Watch's network/zip/xlsx side — the direct
 * parallel of production-conditions/backfill.ts, kept separate from
 * nbs-ingest-logic.ts's pure parsing so that file stays unit-testable with
 * no real network, zip, or xlsx library involved.
 *
 * NBS's catalog publishes ONE file per month, not a queryable date-range
 * API, so there's no equivalent of FAOSTAT's "?year=2020,2021,2022" query
 * parameter — fetchChunk here fetches the catalog page itself and
 * downloads every month's ZIP whose parsed period falls inside the
 * chunk's date span (reusing the generic backfill framework's date-span
 * chunking exactly like production_conditions' enumerateYears() does, just
 * at month granularity instead of year granularity). The steady-state
 * weekly cron (see src/app/api/ingest/commodity-prices-nbs/route.ts) only
 * ever asks for the latest month, which is cheap and fast.
 */

const CATALOG_URL = "https://microdata.nigerianstat.gov.ng/index.php/catalog/162";

async function fetchCatalogHtml(): Promise<string> {
  const res = await fetch(CATALOG_URL, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`NBS catalog request failed: HTTP ${res.status}`);
  }
  return res.text();
}

function cellToPlainValue(value: unknown): NbsCellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const maybe = value as { result?: unknown; richText?: Array<{ text?: string }> };
    if (typeof maybe.result === "number" || typeof maybe.result === "string") return maybe.result;
    if (Array.isArray(maybe.richText)) {
      return maybe.richText.map((segment) => segment.text ?? "").join("");
    }
  }
  return String(value);
}

async function extractXlsxRowsFromZip(zipBuffer: Buffer): Promise<NbsCellValue[][][]> {
  // Defensive check, same spirit as World Bank RTFP's HTML-page check: a
  // login/terms page would come back as a small HTML document, not a
  // multi-megabyte ZIP. Catching that here (rather than letting AdmZip
  // throw a generic "invalid signature" error) names the actual problem.
  const looksLikeHtml = zipBuffer.subarray(0, 200).toString("utf8").toLowerCase().includes("<html");
  if (looksLikeHtml) {
    throw new Error(
      "NBS download returned an HTML page instead of a ZIP file — the catalog's download link " +
        "may now require sign-in. Refusing to parse it as data. See SECURITY.md."
    );
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch (err) {
    throw new Error(
      `NBS download was not a valid ZIP archive (${(err as Error).message}) — the live file's ` +
        "format doesn't match what this ingestor expects."
    );
  }
  const xlsxEntry = zip.getEntries().find((entry) => entry.entryName.toLowerCase().endsWith(".xlsx"));
  if (!xlsxEntry) {
    throw new Error(
      "NBS Selected Food Price Watch ZIP did not contain an .xlsx file — the live archive's " +
        "contents don't match what this ingestor expects, refusing to guess."
    );
  }

  const workbook = new ExcelJS.Workbook();
  // Cast through `any` (not `as unknown as Buffer`) because exceljs's own
  // vendored Buffer type and @types/adm-zip's Buffer return type disagree
  // structurally on this project's @types/node version — both are the
  // same runtime Buffer; this is a types-package version mismatch
  // between two dependencies' own bundled typings, not a real mismatch.
  await workbook.xlsx.load(xlsxEntry.getData() as any); // eslint-disable-line @typescript-eslint/no-explicit-any

  const sheets: NbsCellValue[][][] = [];
  for (const worksheet of workbook.worksheets) {
    const rows: NbsCellValue[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values: NbsCellValue[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        values.push(cellToPlainValue(cell.value));
      });
      rows.push(values);
    });
    sheets.push(rows);
  }
  return sheets;
}

/**
 * fetchChunk returns every catalog entry whose period falls within
 * [chunkStart, chunkEnd] (month granularity — a period is "in range" if
 * its first-of-month date falls between the chunk's own start/end dates),
 * each already downloaded and reduced to plain worksheet rows. The weekly
 * cron route calls this with a narrow one-week span, which in practice
 * only ever matches the single latest month.
 */
export async function fetchNbsBackfillChunk(
  chunkStart: string,
  chunkEnd: string
): Promise<{ periodDate: string; sheets: NbsCellValue[][][] }[]> {
  const html = await fetchCatalogHtml();
  const entries = findAllNbsCatalogEntries(html).filter(
    (e) => e.periodDate >= chunkStart.slice(0, 7) + "-01" && e.periodDate <= chunkEnd
  );
  // A single-month weekly cron chunk will usually match exactly one entry
  // (the latest). A wide backfill chunk can match many — each is fetched
  // and parsed in turn, so a slow or failing month never blocks the rest.

  const results: { periodDate: string; sheets: NbsCellValue[][][] }[] = [];
  for (const entry of entries) {
    // 45s, not the original 30s — same preemptive reasoning as World Bank
    // RTFP's CSV fetch above: this is the real monthly ZIP download, not
    // the small catalog HTML page fetchCatalogHtml() above pulls, and that
    // small-page/big-payload split is exactly where the production
    // conditions and World Bank timeouts turned out to be too short.
    const res = await fetch(entry.downloadUrl, { cache: "no-store", signal: AbortSignal.timeout(45_000) });
    if (!res.ok) {
      throw new Error(`NBS file download failed (${entry.downloadUrl}): HTTP ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const sheets = await extractXlsxRowsFromZip(buffer);
    results.push({ periodDate: entry.periodDate, sheets });
  }
  return results;
}


export function parseNbsBackfillChunk(
  data: { periodDate: string; sheets: NbsCellValue[][][] }[]
): NormalizedPriceObservation[] {
  const rows: NormalizedPriceObservation[] = [];
  for (const { periodDate, sheets } of data) {
    for (const sheetRows of sheets) {
      rows.push(...parseNbsWorksheetRows(sheetRows, periodDate));
    }
  }
  return rows;
}

export async function writeNbsBackfillChunk(
  data: { periodDate: string; sheets: NbsCellValue[][][] }[]
): Promise<number> {
  const rows = parseNbsBackfillChunk(data);
  if (rows.length === 0) return 0;

  const admin = getSupabaseAdminClient();
  const { error } = await admin.from("commodity_price_observations").upsert(
    rows.map((r) => ({
      commodity: r.commodity,
      source: r.source,
      price_type: r.priceType,
      value: r.value,
      unit: r.unit,
      currency: r.currency,
      period_date: r.periodDate,
      region: r.region,
      raw_item_label: r.rawItemLabel ?? null,
    })),
    { onConflict: "commodity,source,price_type,period_date,region" }
  );
  if (error) throw new Error(`commodity_price_observations (NBS) upsert failed: ${error.message}`);

  return rows.length;
}
