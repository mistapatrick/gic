import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env.server";
import { isAuthorizedBearer } from "@/lib/auth/cron-auth";
import {
  fetchFoodSecurityIncrementalChunk,
  writeFoodSecurityBackfillChunk,
} from "@/lib/domains/food-security/backfill";

/**
 * Weekly steady-state ingest for HDX HAPI's food-security indicator — a
 * new domain, independent of every other ingest route. See
 * food-security/backfill.ts for the app-identifier auth flow and
 * pagination.
 *
 * Uses the incremental fetch with a lookback window, not the full-history
 * backfill function (that one is reserved for the one-time admin backfill —
 * see domain-adapters.ts). Confirmed in production on 2026-11-28: calling
 * the full-history function every week re-paginates through the entire HDX
 * dataset (40+ sequential requests) and trips HDX's own rate limiting
 * (HTTP 429) partway through. LOOKBACK_DAYS matches the convention already
 * used by the NBS commodity-prices route — idempotent upsert makes
 * re-checking a short window on every run harmless.
 */
const LOOKBACK_DAYS = 90;

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let env;
  try {
    env = getServerEnv();
  } catch (err) {
    console.error("[ingest/food-security] environment misconfigured:", err);
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (!isAuthorizedBearer(req.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let records: Array<Record<string, unknown>>;
  try {
    const lookbackStart = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const startDate = lookbackStart.toISOString().slice(0, 10);
    records = await fetchFoodSecurityIncrementalChunk(startDate);
  } catch (err) {
    console.error("[ingest/food-security] fetch failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "HDX HAPI food-security fetch failed" },
      { status: 502 }
    );
  }

  let rowsWritten: number;
  try {
    rowsWritten = await writeFoodSecurityBackfillChunk(records);
  } catch (err) {
    console.error("[ingest/food-security] write failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "HDX HAPI food-security write failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    status: "success",
    rows_written: rowsWritten,
  });
}
