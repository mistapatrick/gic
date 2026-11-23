import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env.server";
import { isAuthorizedBearer } from "@/lib/auth/cron-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildFaostatUrl,
  parseFaostatRecords,
  FaostatResponseSchema,
  FAOSTAT_AREA_CODE_NIGERIA,
} from "@/lib/domains/production-conditions/ingest-logic";

/**
 * Weekly steady-state ingest for production_conditions — the FAOSTAT
 * counterpart to /api/ingest (weather's nightly route). Its own route, its
 * own failure mode, independent of weather: the modularity rule applied to
 * a second domain.
 *
 * FAOSTAT publishes annually, not daily/weekly, so most Saturday runs of
 * this route will find nothing new and simply re-upsert the same figures
 * (harmless — the unique (commodity, metric, year, region) constraint makes
 * every write idempotent). The real purpose of running it weekly rather
 * than, say, monthly is to catch a release landing in an unpredictable
 * window without anyone having to remember to trigger a backfill for it.
 *
 * Deliberately re-fetches the last 3 calendar years every run (not just
 * the current year) — FAOSTAT sometimes revises recent years' figures
 * after their first release, and re-upserting is free under the idempotent
 * unique constraint, so there's no reason to risk missing a correction.
 * Anything older than that is the backfill job's job, not this cron's.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const LOOKBACK_YEARS = 3;

export async function POST(req: NextRequest) {
  let env;
  try {
    env = getServerEnv();
  } catch (err) {
    console.error("[ingest/production-conditions] environment misconfigured:", err);
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (!isAuthorizedBearer(req.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const thisYear = new Date().getUTCFullYear();
  const years = Array.from({ length: LOOKBACK_YEARS }, (_, i) => thisYear - i);

  const url = buildFaostatUrl(FAOSTAT_AREA_CODE_NIGERIA, years);
  let res: Response;
  try {
    // 45s, not 20s: buildFaostatUrl() deliberately omits item/element filters
    // (see its own comment — avoids guessing an unconfirmed numeric code) and
    // fetches everything FAOSTAT has for Nigeria across LOOKBACK_YEARS years
    // in one request. A real production run timed out at 20s; FAOSTAT's
    // public API can legitimately take longer than that to generate an
    // unfiltered multi-year response. 45s leaves ~15s of the route's own
    // 60s maxDuration for the JSON parse, Zod validation, and Supabase
    // writes that still have to happen after this fetch returns.
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(45_000) });
  } catch (err) {
    console.error("[ingest/production-conditions] FAOSTAT request failed:", err);
    return NextResponse.json({ error: "FAOSTAT fetch failed" }, { status: 502 });
  }
  if (!res.ok) {
    // Previously logged nothing here, so a non-2xx FAOSTAT response (as
    // opposed to the fetch itself timing out, handled above) was a dead
    // end to diagnose from Vercel's logs alone. Cap the body read — an
    // error page can be arbitrarily large, and this is diagnostics, not
    // data.
    const bodySnippet = await res.text().then((t) => t.slice(0, 500)).catch(() => "<unreadable>");
    console.error(
      `[ingest/production-conditions] FAOSTAT responded with HTTP ${res.status} ${res.statusText}:`,
      bodySnippet
    );
    return NextResponse.json({ error: "FAOSTAT fetch failed" }, { status: 502 });
  }

  const rawData: unknown = await res.json();
  const parsed = FaostatResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    console.error("[ingest/production-conditions] FAOSTAT response failed validation:", parsed.error.message);
    return NextResponse.json({ error: "FAOSTAT response shape unexpected" }, { status: 502 });
  }

  let rows;
  try {
    rows = parseFaostatRecords(parsed.data, FAOSTAT_AREA_CODE_NIGERIA);
  } catch (err) {
    // The defensive Area-name check in parseFaostatRecords throwing is a
    // configuration problem (wrong area code), not a transient failure —
    // surface it clearly rather than retry-looping on bad data.
    console.error("[ingest/production-conditions] defensive validation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "FAOSTAT validation failed" },
      { status: 500 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({
      status: "success",
      years_checked: years,
      rows_written: 0,
      note: "No new or revised figures for the checked years this run.",
    });
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { error: upsertErr } = await supabaseAdmin
    .from("production_conditions")
    .upsert(rows, { onConflict: "commodity,metric,year,region" });

  if (upsertErr) {
    console.error("[ingest/production-conditions] upsert failed:", upsertErr);
    return NextResponse.json({ error: "Database write failed" }, { status: 500 });
  }

  return NextResponse.json({
    status: "success",
    years_checked: years,
    rows_written: rows.length,
  });
}
