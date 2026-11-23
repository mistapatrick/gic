import "server-only";
import { parse } from "csv-parse/sync";
import {
  findLatestWorldBankCsvLink,
  parseWorldBankRtfpRecords,
} from "@/lib/domains/commodity-prices/worldbank-rtfp-ingest-logic";
import type { NormalizedPriceObservation } from "@/lib/domains/commodity-prices/price-types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

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

const CATALOG_URL = "https://microdata.worldbank.org/index.php/catalog/4503";

async function fetchCatalogHtml(): Promise<string> {
  const res = await fetch(CATALOG_URL, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`World Bank RTFP catalog request failed: HTTP ${res.status}`);
  }
  return res.text();
}

async function fetchCsvText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
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
