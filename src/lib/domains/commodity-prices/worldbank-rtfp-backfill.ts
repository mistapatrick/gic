import "server-only";
import { parse } from "csv-parse/sync";
import {
  findLatestWorldBankCsvLink,
  parseWorldBankRtfpRecords,
} from "@/lib/domains/commodity-prices/worldbank-rtfp-ingest-logic";
import type { NormalizedPriceObservation } from "@/lib/domains/commodity-prices/price-types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { GIC_OUTBOUND_HEADERS } from "@/lib/ingestion/outbound-headers";

/**
 * World Bank RTFP's network/catalog/CSV side — the direct parallel of
 * nbs-backfill.ts, kept separate from worldbank-rtfp-ingest-logic.ts's
 * pure parsing for the same testability reason.
 *
 * Unlike NBS (one file per month) or FAOSTAT (queryable by year), RTFP
 * publishes ONE CSV per country containing its ENTIRE time series back to
 * 2007, re-released under a new dated filename roughly weekly. That means
 * every fetch — whether the weekly cron or a backfill chunk of any width
 * — downloads and parses the exact same (whole-history) file; there's no
 * narrower request to make. The chunk's date span is accepted for
 * interface consistency with the generic backfill framework but doesn't
 * change what's fetched, only whether this call happens at all (the
 * framework still drives pacing/resumability at the call-site level).
 */

// Points at the data-dictionary page, not the catalog landing page
// (/catalog/4503). Confirmed live: the landing page genuinely contains no
// CSV filename anywhere in its HTML — that's why every backfill attempt
// against it failed with "Could not find a dated NGA_RTFP_mkt_*.csv link".
// The filename only appears on this data-dictionary sub-page, as a link
// styled "NGA_RTFP_mkt_<start_year>_<release_date>.csv".
//
// One thing this fix does NOT resolve, and a live check couldn't settle
// either way: that filename link does not point to the raw CSV — it
// reloads the same data-dictionary page with a `file_name` query param,
// which only ever serves documentation (variable list, case count), never
// the file itself. The only other path found is a "Get Microdata" button
// pointing at a page with a visible Login link and no page text
// confirming whether download works without an account. If the actual
// download turns out to require a login this way, the HTML-wall check in
// fetchCsvText() below should catch it and throw a clear, specific error
// rather than silently writing nothing — but if that happens consistently,
// commodity_prices_worldbank_rtfp likely needs to go back to manual-entry
// treatment like AFEX, not stay on this automated path. See the backfill
// job's own `last_error` column for what actually happens on the next run.
const CATALOG_URL = "https://microdata.worldbank.org/catalog/4503/data-dictionary";

async function fetchCatalogHtml(): Promise<string> {
  const res = await fetch(CATALOG_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    headers: GIC_OUTBOUND_HEADERS,
  });
  if (!res.ok) {
    throw new Error(`World Bank RTFP catalog request failed: HTTP ${res.status}`);
  }
  return res.text();
}

async function fetchCsvText(url: string): Promise<string> {
  // 45s, not the original 30s: raised preemptively, not from an observed
  // failure here specifically. production_conditions' own fetch (same
  // sandbox, same inability to test live) turned out to need 45s once
  // actually exercised against a real deployment, after 20s proved too
  // short twice (the live route, then separately this domain's own
  // catalog-page fetch above). This is the real whole-history CSV, not the
  // small catalog HTML page fetchCatalogHtml() above pulls — the same
  // small-page-vs-big-payload gap that caused that earlier bug, caught
  // here before it reproduces instead of after.
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
    headers: GIC_OUTBOUND_HEADERS,
  });
  if (!res.ok) {
    throw new Error(`World Bank RTFP CSV download failed (${url}): HTTP ${res.status}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  // Defensive check, same spirit as FAOSTAT's Area-name validation: a
  // login/terms-of-use page would come back as HTML, not CSV. Catching
  // that here — rather than letting the CSV parser choke on it or, worse,
  // silently "succeed" with zero usable rows — is what keeps a gated
  // download from looking like a quiet, successful no-op run.
  const looksLikeHtml =
    contentType.includes("html") || text.trim().slice(0, 200).toLowerCase().includes("<html");
  if (looksLikeHtml) {
    throw new Error(
      "World Bank RTFP download returned an HTML page instead of a CSV file — this usually means " +
        "the catalog's download link now requires sign-in or a click-through terms step this " +
        "ingestor doesn't perform. Refusing to parse it as data. See SECURITY.md for the " +
        "live-verification follow-up this flags."
    );
  }
  return text;
}

export async function fetchWorldBankRtfpBackfillChunk(): Promise<string> {
  const html = await fetchCatalogHtml();
  const csvUrl = findLatestWorldBankCsvLink(html);
  if (!csvUrl) {
    throw new Error(
      "Could not find a dated NGA_RTFP_mkt_*.csv link on the World Bank RTFP catalog page — " +
        "the page's structure may have changed since this was written."
    );
  }
  return fetchCsvText(csvUrl);
}

export function parseWorldBankRtfpBackfillChunk(csvText: string): NormalizedPriceObservation[] {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Array<Record<string, string>>;
  return parseWorldBankRtfpRecords(records);
}

export async function writeWorldBankRtfpBackfillChunk(csvText: string): Promise<number> {
  const rows = parseWorldBankRtfpBackfillChunk(csvText);
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
  if (error) throw new Error(`commodity_price_observations (World Bank RTFP) upsert failed: ${error.message}`);

  return rows.length;
}
