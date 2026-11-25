import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env.server";
import { isAuthorizedBearer } from "@/lib/auth/cron-auth";
import {
  fetchFewsNetBackfillChunk,
  writeFewsNetBackfillChunk,
} from "@/lib/domains/commodity-prices/fewsnet-backfill";

/**
 * Weekly steady-state ingest for FEWS NET — commodity_prices' third
 * automated source, independent of NBS, World Bank RTFP, and AFEX's
 * manual-entry flow. See fewsnet-backfill.ts for why this fetches and
 * re-upserts the dataset's entire history on every run (same shape as
 * World Bank RTFP's own route).
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let env;
  try {
    env = getServerEnv();
  } catch (err) {
    console.error("[ingest/commodity-prices-fewsnet] environment misconfigured:", err);
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (!isAuthorizedBearer(req.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let records: Array<Record<string, unknown>>;
  try {
    records = await fetchFewsNetBackfillChunk();
  } catch (err) {
    console.error("[ingest/commodity-prices-fewsnet] fetch failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "FEWS NET fetch failed" },
      { status: 502 }
    );
  }

  let rowsWritten: number;
  try {
    rowsWritten = await writeFewsNetBackfillChunk(records);
  } catch (err) {
    console.error("[ingest/commodity-prices-fewsnet] write failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "FEWS NET write failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    status: "success",
    rows_written: rowsWritten,
  });
}
