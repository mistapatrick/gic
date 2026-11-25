import type { NormalizedPriceObservation } from "@/lib/domains/commodity-prices/price-types";

/**
 * Pure parsing logic for FEWS NET's Nigeria staple food price export,
 * hosted on HDX (data.humdata.org) — commodity_prices' THIRD automated
 * source, alongside NBS and World Bank RTFP. See fewsnet-backfill.ts for
 * the network/HDX-catalog side.
 *
 * CAVEAT, same category as worldbank-rtfp-ingest-logic.ts's and
 * nbs-ingest-logic.ts's: this build environment's network allowlist
 * blocks data.humdata.org directly, so the column names matched below are
 * inferred from FEWS NET's own published Data Warehouse upload-file schema
 * (help.fews.net/fdw/prices: country, market, product, product_name,
 * price_type, product_source, unit, price — a live Guinea-Bissau example
 * showed exactly those columns) rather than confirmed against Nigeria's
 * own live export. Matching is case-insensitive and defensive; if a live
 * file doesn't carry a recognizable column, this throws rather than
 * guessing.
 *
 * SEPARATE, CONFIRMED CAVEAT — not a build-environment limitation, an
 * actual finding: FEWS NET's own markets-and-trade page states that
 * "[d]ue to a pause in operations in early 2025, FEWS NET-collected
 * markets and trade data are unavailable for recent months"
 * (fews.net/data/markets-and-trade), and HDX's Nigeria dataset page shows
 * its most recently modified price resource dated 12 August 2024 — over a
 * year stale as of this build, despite the dataset's own "Expected Update
 * Frequency: Every week" metadata. This ingestor is still wired up and
 * scheduled weekly (per the user's explicit choice to keep it switched off
 * at the application level until they decide how it fits in, not to skip
 * building it), but expect it to keep re-upserting the same historical
 * snapshot rather than genuinely new data until FEWS NET resumes
 * collection — that is a FEWS NET-side fact, not a bug in this ingestor.
 */

export interface FewsNetCommodityVariant {
  commodity: string;
  nameContains: string[];
}

/**
 * Matched against each row's product_name (free text), not a column
 * header — FEWS NET's export is long-format (one row per market / product
 * / price_type / period), the same shape as production_conditions' bulk
 * CSV, not World Bank RTFP's wide-format columns-per-commodity shape.
 */
export const FEWS_NET_COMMODITY_VARIANTS: FewsNetCommodityVariant[] = [
  { commodity: "Maize", nameContains: ["maize"] },
  { commodity: "Rice (paddy)", nameContains: ["rice"] },
  { commodity: "Sorghum", nameContains: ["sorghum"] },
  { commodity: "Millet", nameContains: ["millet"] },
  { commodity: "Cassava", nameContains: ["cassava", "gari"] },
  { commodity: "Yams", nameContains: ["yam"] },
  { commodity: "Cowpeas", nameContains: ["cowpea"] },
  { commodity: "Groundnuts", nameContains: ["groundnut"] },
  { commodity: "Soya beans", nameContains: ["soybean", "soya bean", "soya"] },
  { commodity: "Cocoa beans", nameContains: ["cocoa"] },
  { commodity: "Oil palm fruit", nameContains: ["palm oil", "palm"] },
  { commodity: "Sesame seed", nameContains: ["sesame"] },
  { commodity: "Cattle meat", nameContains: ["beef", "cattle"] },
  { commodity: "Cow milk", nameContains: ["milk"] },
];

export function matchFewsNetProductName(productName: string): string | null {
  const lower = productName.toLowerCase();
  const variant = FEWS_NET_COMMODITY_VARIANTS.find((v) => v.nameContains.some((s) => lower.includes(s)));
  return variant?.commodity ?? null;
}

const COUNTRY_KEYS = ["country"];
const MARKET_KEYS = ["market"];
const PRODUCT_NAME_KEYS = ["product_name", "productname", "product"];
const PRICE_TYPE_KEYS = ["price_type", "pricetype"];
const UNIT_KEYS = ["unit"];
const PRICE_KEYS = ["price", "value"];
const DATE_KEYS = ["period_date", "date", "collection_date", "period"];

function findKey(record: Record<string, unknown>, candidates: string[]): string | null {
  const keys = Object.keys(record);
  for (const candidate of candidates) {
    const found = keys.find((k) => k.toLowerCase() === candidate);
    if (found) return found;
  }
  return null;
}

function toTrimmedString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isNigeriaRow(record: Record<string, unknown>, countryKey: string | null): boolean {
  if (!countryKey) {
    // No country column at all — assume the file is already Nigeria-only,
    // same fallback worldbank-rtfp-ingest-logic.ts's isNigeriaRow() takes
    // (this is the country-specific HDX dataset, not a global dump).
    return true;
  }
  const value = toTrimmedString(record[countryKey]).toLowerCase();
  return value === "nigeria" || value === "nga";
}

function normalizePeriod(raw: string): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/) ?? trimmed.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  if (match.length === 4) return `${match[1]}-${match[2]}-${match[3]}`;
  return `${match[1]}-${match[2]}-01`;
}

/**
 * records is an array of plain objects — one per price observation row,
 * already parsed by the fetch layer from the JSON resource FEWS NET
 * publishes on HDX (see fewsnet-backfill.ts). Returns one normalized
 * observation per (commodity, period), averaged across every Nigerian
 * market present for that period — matching the same market-to-national
 * aggregation World Bank RTFP's own parser performs, and GIC's "National"
 * region convention.
 *
 * Only rows whose own price_type is "retail" are included (FEWS NET also
 * reports wholesale/producer/assembly/export/spot/wage prices for some
 * markets) — comparing a retail figure against NBS/World Bank RTFP's own
 * retail figures is the one apples-to-apples comparison this domain makes;
 * blending in a different price_type would silently misrepresent what's
 * being compared, the same discipline priceTypeForSource()'s own doc
 * comment describes.
 */
export function parseFewsNetRecords(records: Array<Record<string, unknown>>): NormalizedPriceObservation[] {
  if (records.length === 0) return [];

  const firstRecord = records[0];
  const countryKey = findKey(firstRecord, COUNTRY_KEYS);
  const marketKey = findKey(firstRecord, MARKET_KEYS);
  const productNameKey = findKey(firstRecord, PRODUCT_NAME_KEYS);
  const priceTypeKey = findKey(firstRecord, PRICE_TYPE_KEYS);
  const unitKey = findKey(firstRecord, UNIT_KEYS);
  const priceKey = findKey(firstRecord, PRICE_KEYS);
  const dateKey = findKey(firstRecord, DATE_KEYS);

  if (!productNameKey || !priceTypeKey || !priceKey || !dateKey) {
    throw new Error(
      `FEWS NET response is missing a required column among [${Object.keys(firstRecord).join(", ")}] — ` +
        `needed product_name/product, price_type, price/value, and a date column, but found ` +
        `product_name=${productNameKey}, price_type=${priceTypeKey}, price=${priceKey}, date=${dateKey}. ` +
        `Refusing to guess.`
    );
  }

  // Sums/counts per (commodity, period) for the market-to-national average.
  const sums = new Map<string, { sum: number; count: number }>();

  for (const record of records) {
    if (!isNigeriaRow(record, countryKey)) continue;

    const priceType = toTrimmedString(record[priceTypeKey]).toLowerCase();
    if (priceType !== "retail") continue;

    const productName = toTrimmedString(record[productNameKey]);
    const commodity = matchFewsNetProductName(productName);
    if (!commodity) continue;

    const periodDate = normalizePeriod(toTrimmedString(record[dateKey]));
    if (!periodDate) continue;

    const rawPrice = record[priceKey];
    if (rawPrice === "NC" || rawPrice === "NA" || rawPrice === null || rawPrice === undefined || rawPrice === "")
      continue;
    const value = Number(rawPrice);
    if (!Number.isFinite(value) || value <= 0) continue;

    const groupKey = `${commodity}::${periodDate}`;
    const existing = sums.get(groupKey) ?? { sum: 0, count: 0 };
    existing.sum += value;
    existing.count += 1;
    sums.set(groupKey, existing);
  }

  const unitLabel = (() => {
    if (!unitKey) return "NGN per kg";
    const sampleUnit = toTrimmedString(firstRecord[unitKey]).toLowerCase();
    return sampleUnit ? `NGN per ${sampleUnit}` : "NGN per kg";
  })();

  const results: NormalizedPriceObservation[] = [];
  for (const [groupKey, { sum, count }] of sums) {
    const [commodity, periodDate] = groupKey.split("::");
    results.push({
      commodity,
      source: "FEWS_NET",
      priceType: "retail",
      value: sum / count,
      unit: unitLabel,
      currency: "NGN",
      periodDate,
      region: "National",
      rawItemLabel: null,
    });
  }

  // marketKey is read defensively above (findKey) so a future per-market
  // breakdown can be added without re-deriving which column holds it, but
  // the current aggregation deliberately collapses markets into one
  // national figure — not referenced further here.
  void marketKey;

  return results.sort((a, b) => (a.commodity + a.periodDate).localeCompare(b.commodity + b.periodDate));
}

/**
 * Extracts the download URL for a named resource format from an HDX CKAN
 * package_show response (https://data.humdata.org/api/action/package_show).
 * Pure JSON-shape validation — the fetch layer hands this the parsed JSON
 * it already retrieved. Mirrors production-conditions' own
 * extractBulkDownloadUrl(): resolve the real, current URL from the
 * platform's own catalog response rather than trusting a hardcoded
 * filename, since HDX resource URLs embed a resource UUID that can change
 * between dataset revisions.
 */
export function findHdxResourceUrl(packageShowJson: unknown, preferredFormat: string): string {
  if (
    typeof packageShowJson !== "object" ||
    packageShowJson === null ||
    !("result" in packageShowJson) ||
    typeof (packageShowJson as { result?: unknown }).result !== "object" ||
    (packageShowJson as { result?: unknown }).result === null
  ) {
    throw new Error(
      "HDX package_show response has no 'result' object — its response shape may differ from what " +
        "this parser expects."
    );
  }

  const result = (packageShowJson as { result: { resources?: unknown } }).result;
  if (!Array.isArray(result.resources)) {
    throw new Error("HDX package_show response's result.resources is not an array — refusing to guess.");
  }

  const resources = result.resources as Array<{ format?: unknown; url?: unknown }>;
  const match = resources.find(
    (r) => typeof r.format === "string" && r.format.toUpperCase() === preferredFormat.toUpperCase()
  );
  if (!match || typeof match.url !== "string" || match.url.length === 0) {
    const formats = resources.map((r) => (typeof r.format === "string" ? r.format : "?")).join(", ");
    throw new Error(
      `HDX dataset has no "${preferredFormat}"-format resource with a URL — only found formats: [${formats}].`
    );
  }
  return match.url;
}
