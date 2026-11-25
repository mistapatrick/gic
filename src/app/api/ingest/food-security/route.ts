import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env.server";
import { isAuthorizedBearer } from "@/lib/auth/cron-auth";
import {
  fetchFoodSecurityBackfillChunk,
  writeFoodSecurityBackfillChunk,
} from "@/lib/domains/food-security/backfill";

/**
 * Weekly steady-state ingest for HDX HAPI's food-security indicator — a
 * new domain, independent of every other ingest route. See
 * food-security/backfill.ts for the app-identifier auth flow and
 * pagination.
 */
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
    records = await fetchFoodSecurityBackfillChunk();
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
