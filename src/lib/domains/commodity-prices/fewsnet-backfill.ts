import "server-only";
import {
  findHdxResourceUrl,
  parseFewsNetRecords,
} from "@/lib/domains/commodity-prices/fewsnet-ingest-logic";
import type { NormalizedPriceObservation } from "@/lib/domains/commodity-prices/price-types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { GIC_OUTBOUND_HEADERS } from "@/lib/ingestion/outbound-headers";

/**
 * FEWS NET's network/HDX-catalog side — the direct parallel of
 * worldbank-rtfp-backfill.ts and production-conditions/bulk-backfill.ts,
 * kept separate from fewsnet-ingest-logic.ts's pure parsing for the same
 * testability reason.
 *
 * Resolves the dataset's current JSON resource URL from HDX's own CKAN
 * package_show catalog endpoint first, rather than hardcoding a resource
 * UUID that can change between dataset revisions — the same lesson
 * production_conditions_bulk's HTTP 403 taught (see that file's own
 * comment): never hardcode a third-party platform's download URL, resolve
 * it from the platform's own catalog API at request time.
 *
 * Like World Bank RTFP, FEWS NET publishes one file covering the dataset's
 * entire history rather than a queryable date-range API, so there is no
 * narrower request to make — every run (cron or backfill) re-fetches and
 * re-upserts the same file, which the idempotent unique constraint on
 * commodity_price_observations makes harmless.
 */

// The dataset's url-safe "stub" on HDX, confirmed via web search against
// data.humdata.org (this build environment's network allowlist blocks
// humdata.org directly, so this could not be re-verified live from here —
// if it has changed, package_show below will fail with a clear 404/error
// rather than silently fetching the wrong dataset).
const HDX_DATASET_ID = "fewsnet_staple_food_price_data_for_nigeria_weekly_6837";
const HDX_PACKAGE_SHOW_URL = `https://data.humdata.org/api/action/package_show?id=${HDX_DATASET_ID}`;

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { ...GIC_OUTBOUND_HEADERS, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Request to ${url} failed: HTTP ${res.status}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  const looksLikeHtml =
    contentType.includes("html") || text.trim().slice(0, 200).toLowerCase().includes("<html");
  if (looksLikeHtml) {
    throw new Error(
      `Request to ${url} returned an HTML page instead of JSON — this usually means the endpoint ` +
        "now requires sign-in or has moved. Refusing to parse it as data."
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Request to ${url} did not return valid JSON.`);
  }
}

async function resolveFewsNetResourceUrl(): Promise<string> {
  const packageShowJson = await fetchJson(HDX_PACKAGE_SHOW_URL, 20_000);
  return findHdxResourceUrl(packageShowJson, "JSON");
}

/**
 * The resource's JSON body shape isn't independently confirmed from this
 * build environment either — HDX's generic CKAN resource export is most
 * commonly a flat array of row objects, but some exports wrap rows under a
 * "data"/"records" key. Both are handled; anything else throws rather than
 * silently returning zero rows.
 */
function extractRecords(resourceJson: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(resourceJson)) {
    return resourceJson as Array<Record<string, unknown>>;
  }
  if (typeof resourceJson === "object" && resourceJson !== null) {
    const obj = resourceJson as Record<string, unknown>;
    for (const key of ["data", "records", "rows"]) {
      if (Array.isArray(obj[key])) return obj[key] as Array<Record<string, unknown>>;
    }
  }
  throw new Error(
    "FEWS NET resource JSON is neither a flat array nor an object with a data/records/rows array — " +
      "its shape may differ from what this parser expects."
  );
}

export async function fetchFewsNetBackfillChunk(): Promise<Array<Record<string, unknown>>> {
  const resourceUrl = await resolveFewsNetResourceUrl();
  const resourceJson = await fetchJson(resourceUrl, 45_000);
  return extractRecords(resourceJson);
}

export function parseFewsNetBackfillChunk(
  records: Array<Record<string, unknown>>
): NormalizedPriceObservation[] {
  return parseFewsNetRecords(records);
}

export async function writeFewsNetBackfillChunk(records: Array<Record<string, unknown>>): Promise<number> {
  const rows = parseFewsNetBackfillChunk(records);
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
  if (error) throw new Error(`commodity_price_observations (FEWS NET) upsert failed: ${error.message}`);

  return rows.length;
}
