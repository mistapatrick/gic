import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env.server";
import { isAuthorizedBearer } from "@/lib/auth/cron-auth";
import { fetchNbsBackfillChunk, writeNbsBackfillChunk } from "@/lib/domains/commodity-prices/nbs-backfill";

/**
 * Weekly steady-state ingest for NBS's Selected Food Price Watch — its own
 * route, its own failure mode, independent of production_conditions, the
 * other commodity-price source (World Bank RTFP), and AFEX's manual-entry
 * flow: the modularity rule applied again.
 *
 * Reuses nbs-backfill.ts's own fetch/write functions (catalog scrape, ZIP
 * download, defensive HTML-page check, xlsx parse, idempotent upsert)
 * rather than re-implementing any of that inline — a 90-day lookback
 * window comfortably covers "whatever NBS's latest published month is"
 * without needing to know today's exact report-publication lag, and the
 * idempotent unique constraint makes re-upserting an already-ingested
 * month harmless. Pulling NBS's FULL back-catalog is the backfill job's
 * job (same file, wider range, triggered from /admin), not this cron's.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const LOOKBACK_DAYS = 90;

export async function POST(req: NextRequest) {
  let env;
  try {
    env = getServerEnv();
  } catch (err) {
    console.error("[ingest/commodity-prices-nbs] environment misconfigured:", err);
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (!isAuthorizedBearer(req.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  const rangeEnd = today.toISOString().slice(0, 10);
  const rangeStart = new Date(today.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);

  let data;
  try {
    data = await fetchNbsBackfillChunk(rangeStart, rangeEnd);
  } catch (err) {
    console.error("[ingest/commodity-prices-nbs] fetch failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "NBS fetch failed" },
      { status: 502 }
    );
  }

  let rowsWritten: number;
  try {
    rowsWritten = await writeNbsBackfillChunk(data);
  } catch (err) {
    console.error("[ingest/commodity-prices-nbs] write failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "NBS write failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    status: "success",
    periods_checked: data.map((d) => d.periodDate),
    rows_written: rowsWritten,
  });
}
