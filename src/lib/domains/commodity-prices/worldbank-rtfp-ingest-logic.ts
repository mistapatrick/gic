import type { NormalizedPriceObservation } from "@/lib/domains/commodity-prices/price-types";

/**
 * Pure, side-effect-free parsing logic for the World Bank's Real-Time Food
 * Prices (RTFP) dataset — the direct parallel of
 * production-conditions/ingest-logic.ts and nbs-ingest-logic.ts. See
 * worldbank-rtfp-fetch.ts for the network/catalog-scraping side.
 *
 * CAVEAT, same category as nbs-ingest-logic.ts's: this build environment's
 * network allowlist blocks worldbank.org directly, so the exact CSV column
 * names below are inferred from data-dictionary text excerpts (a
 * same-methodology country's file showed a column literally named
 * "c_rice_fao"), not confirmed against Nigeria's own live file. The "c_"
 * prefix is RTFP's own documented convention for the dataset's best single
 * price estimate per commodity per market per month (as opposed to the
 * "o_"/"h_"/"l_" open/high/low variants also present) — matching on that
 * prefix is a deliberate choice to avoid accidentally picking a less
 * reliable column. If a live file doesn't carry any "c_"-prefixed column
 * matching a tracked commodity, this throws rather than guessing.
 */

export interface WorldBankCommodityVariant {
  commodity: string;
  columnContains: string[];
}

/**
 * Conservative and evidence-based, same spirit as NBS's variant table:
 * "Seed cotton" is left out because RTFP tracks FOOD prices specifically,
 * and cotton isn't a food item, so including it would just mean a
 * guaranteed-empty match, not a safety issue.
 */
export const WORLD_BANK_COMMODITY_VARIANTS: WorldBankCommodityVariant[] = [
  { commodity: "Maize", columnContains: ["maize"] },
  { commodity: "Rice (paddy)", columnContains: ["rice"] },
  { commodity: "Sorghum", columnContains: ["sorghum"] },
  { commodity: "Millet", columnContains: ["millet"] },
  { commodity: "Cassava", columnContains: ["cassava", "gari"] },
  { commodity: "Yams", columnContains: ["yam"] },
  // Deliberately "cowpea"/"cowpeas" only, not a bare "bean"/"beans": a bare
  // form would also match a "c_cocoa_bean(s)" column (checked later in this
  // list, for Cocoa beans) before this entry is ever reached, mislabeling
  // cocoa data as cowpeas. No confirmed Nigeria RTFP column name for cowpeas
  // exists yet (unlike "c_rice_fao"/"c_maize_fao", seen in a sibling
  // country's dictionary) — this is the conservative, collision-safe guess.
  { commodity: "Cowpeas", columnContains: ["cowpea", "cowpeas"] },
  { commodity: "Groundnuts", columnContains: ["groundnut"] },
  { commodity: "Soya beans", columnContains: ["soy"] },
  { commodity: "Cocoa beans", columnContains: ["cocoa"] },
  { commodity: "Oil palm fruit", columnContains: ["palm"] },
  { commodity: "Sesame seed", columnContains: ["sesame"] },
  { commodity: "Cattle meat", columnContains: ["beef", "cattle"] },
  { commodity: "Cow milk", columnContains: ["milk"] },
];

/**
 * Matches a CSV column header to a tracked commodity, only among columns
 * carrying RTFP's "c_" (close/current-estimate) prefix.
 *
 * Deliberately matches whole underscore-delimited segments, not a raw
 * substring search — a naive `.includes("rice")` would also match
 * "c_food_price_index" (the word "price" contains "rice"), silently
 * mislabeling an unrelated index column as a rice price. A commodity
 * written as one word with no delimiter (e.g. a hypothetical "soybean"
 * with no underscore, instead of "soy_bean") would be missed by this —
 * a safe, visible gap (no data point for that commodity) rather than a
 * wrong one, which is the trade this domain consistently makes wherever
 * the live schema can't be confirmed in advance.
 */
export function matchWorldBankColumn(columnName: string): string | null {
  const lower = columnName.toLowerCase();
  if (!lower.startsWith("c_")) return null;
  const segments = lower.slice(2).split("_");
  const variant = WORLD_BANK_COMMODITY_VARIANTS.find((v) =>
    v.columnContains.some((s) => segments.includes(s))
  );
  return variant?.commodity ?? null;
}

const DATE_COLUMN_NAMES = ["dates", "date"];
const COUNTRY_COLUMN_NAMES = ["iso3", "country_code", "country"];

function normalizePeriod(raw: string): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-01`;
}

function isNigeriaRow(record: Record<string, string>): boolean {
  for (const key of Object.keys(record)) {
    if (COUNTRY_COLUMN_NAMES.includes(key.toLowerCase())) {
      const value = record[key].trim().toLowerCase();
      return value === "nga" || value === "nigeria";
    }
  }
  // No country column at all — assume the file is already Nigeria-only
  // (fetched from the Nigeria-specific catalog entry, not the all-country
  // global file).
  return true;
}

/**
 * records is an array of plain string-keyed objects — one per CSV row,
 * already parsed by the fetch layer (see worldbank-rtfp-fetch.ts). Returns
 * one normalized observation per (commodity, period), already averaged
 * across every Nigerian market present in that period — RTFP publishes
 * market-level estimates, and GIC's "National" region convention (matching
 * production_conditions) means this is where that market-to-national
 * aggregation happens, before cross-source reconciliation ever runs.
 */
export function parseWorldBankRtfpRecords(
  records: Array<Record<string, string>>
): NormalizedPriceObservation[] {
  if (records.length === 0) return [];

  const headerKeys = Object.keys(records[0]);
  const dateKey = headerKeys.find((k) => DATE_COLUMN_NAMES.includes(k.toLowerCase()));
  if (!dateKey) {
    throw new Error(
      `World Bank RTFP response has no recognizable date column among [${headerKeys.join(", ")}] — ` +
        `refusing to guess a period for any row.`
    );
  }

  const commodityColumns = headerKeys
    .map((key) => ({ key, commodity: matchWorldBankColumn(key) }))
    .filter((c): c is { key: string; commodity: string } => c.commodity !== null);

  // Sums/counts per (commodity, period) for the market-to-national average.
  const sums = new Map<string, { sum: number; count: number }>();

  for (const record of records) {
    if (!isNigeriaRow(record)) continue;
    const periodDate = normalizePeriod(record[dateKey] ?? "");
    if (!periodDate) continue;

    for (const { key, commodity } of commodityColumns) {
      const raw = record[key];
      if (raw === undefined || raw === "" || raw === "NA") continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) continue;

      const groupKey = `${commodity}::${periodDate}`;
      const existing = sums.get(groupKey) ?? { sum: 0, count: 0 };
      existing.sum += value;
      existing.count += 1;
      sums.set(groupKey, existing);
    }
  }

  const results: NormalizedPriceObservation[] = [];
  for (const [groupKey, { sum, count }] of sums) {
    const [commodity, periodDate] = groupKey.split("::");
    results.push({
      commodity,
      source: "WORLD_BANK_RTFP",
      priceType: "retail",
      value: sum / count,
      // RTFP's standard unit for grain/staple items is a local-currency
      // price per kg; not independently confirmed against a live Nigeria
      // response from this build environment — same caveat class as the
      // rest of this file.
      unit: "NGN per kg",
      currency: "NGN",
      periodDate,
      region: "National",
      rawItemLabel: null,
    });
  }

  return results.sort((a, b) => (a.commodity + a.periodDate).localeCompare(b.commodity + b.periodDate));
}

/**
 * Extracts the current dated CSV filename/download link for Nigeria's
 * RTFP dataset from the microdata catalog page's raw HTML. Pure
 * string/regex logic — the fetch layer hands this the page text it
 * already retrieved from catalog 4503 (Nigeria-specific).
 */
export function findLatestWorldBankCsvLink(catalogHtml: string): string | null {
  // Matches a filename like "NGA_RTFP_mkt_2007_2026-04-20.csv" anywhere on
  // the page, with or without a surrounding href — the "Data files" tab
  // lists it as plain text in some NADA page renders, not always a link.
  const filenameMatch = catalogHtml.match(/NGA_RTFP_mkt_[\w-]*\.csv/i);
  if (!filenameMatch) return null;

  // Prefer an actual href if one wraps the filename; otherwise fall back
  // to the catalog's documented direct-download convention.
  const hrefMatch = catalogHtml.match(
    new RegExp(`href=["']([^"']*${filenameMatch[0]}[^"']*)["']`, "i")
  );
  if (hrefMatch) {
    return hrefMatch[1].startsWith("http")
      ? hrefMatch[1]
      : `https://microdata.worldbank.org${hrefMatch[1]}`;
  }
  return `https://microdata.worldbank.org/catalog/4503/download/${filenameMatch[0]}`;
}
