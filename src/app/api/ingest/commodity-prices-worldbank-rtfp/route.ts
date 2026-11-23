import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env.server";
import { isAuthorizedBearer } from "@/lib/auth/cron-auth";
import {
  fetchWorldBankRtfpBackfillChunk,
  writeWorldBankRtfpBackfillChunk,
} from "@/lib/domains/commodity-prices/worldbank-rtfp-backfill";

/**
 * Weekly steady-state ingest for World Bank RTFP — its own route, its own
 * failure mode, independent of the other two commodity-price sources
 * (NBS, AFEX's manual-entry flow) and production_conditions.
 *
 * Reuses worldbank-rtfp-backfill.ts's own fetch/write functions (catalog
 * scrape, defensive HTML-page check, CSV parse, idempotent upsert). RTFP
 * republishes Nigeria's entire 2007-to-present history under a new dated
 * filename roughly weekly, so there's no separate "backfill vs steady
 * state" request shape here the way there is for NBS/production
 * conditions — every run (cron or backfill) fetches and re-upserts the
 * same whole-history file, which the idempotent unique constraint makes
 * harmless.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let env;
  try {
    env = getServerEnv();
  } catch (err) {
    console.error("[ingest/commodity-prices-worldbank-rtfp] environment misconfigured:", err);
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (!isAuthorizedBearer(req.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let csvText: string;
  try {
    csvText = await fetchWorldBankRtfpBackfillChunk();
  } catch (err) {
    console.error("[ingest/commodity-prices-worldbank-rtfp] fetch failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "World Bank RTFP fetch failed" },
      { status: 502 }
    );
  }

  let rowsWritten: number;
  try {
    rowsWritten = await writeWorldBankRtfpBackfillChunk(csvText);
  } catch (err) {
    console.error("[ingest/commodity-prices-worldbank-rtfp] write failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "World Bank RTFP write failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    status: "success",
    rows_written: rowsWritten,
  });
}
