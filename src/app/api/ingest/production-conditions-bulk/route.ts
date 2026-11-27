import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env.server";
import { isAuthorizedBearer } from "@/lib/auth/cron-auth";
import {
  fetchProductionConditionsBulkChunk,
  writeProductionConditionsBulkChunkWithDiagnostics,
} from "@/lib/domains/production-conditions/bulk-backfill";

/**
 * production_conditions' SECOND, independent ingest route — the static
 * FAOSTAT bulk-download file, called on its own schedule
 * (.github/workflows/weekly-production-conditions-bulk-ingest.yml),
 * alongside (not replacing) /api/ingest/production-conditions's existing
 * live-query route. See bulk-backfill.ts for why this exists: the live
 * query endpoint returned HTTP 521 on three consecutive attempts,
 * including after both a timeout fix and a User-Agent fix, which pointed
 * at that specific endpoint rather than anything fixable from this app's
 * side. Nothing about this route replaces or disables that one — if
 * FAOSTAT's live endpoint recovers, both routes simply keep both
 * upserting the same idempotent table.
 *
 * Same Vercel Hobby ceiling as every other route in this codebase. See
 * bulk-backfill.ts's own fetch-timeout comment for why this one domain's
 * bulk file is a real, not-yet-confirmed risk against that ceiling in a
 * way the others aren't — this route's own last_error (surfaced via the
 * GitHub Action's run log, since this route has no backfill_jobs row of
 * its own) is what will tell us if that risk was real.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let env;
  try {
    env = getServerEnv();
  } catch (err) {
    console.error("[ingest/production-conditions-bulk] environment misconfigured:", err);
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (!isAuthorizedBearer(req.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rows;
  try {
    rows = await fetchProductionConditionsBulkChunk();
  } catch (err) {
    console.error("[ingest/production-conditions-bulk] fetch failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "FAOSTAT bulk fetch failed" },
      { status: 502 }
    );
  }

  let rowsWritten: number;
  let skippedCommodities: { itemName: string; count: number }[];
  try {
    const result = await writeProductionConditionsBulkChunkWithDiagnostics(rows);
    rowsWritten = result.rowsWritten;
    skippedCommodities = result.skippedCommodities;
  } catch (err) {
    console.error("[ingest/production-conditions-bulk] write failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "FAOSTAT bulk write failed" },
      { status: 500 }
    );
  }

  // No human watches this route fire (it's a manual-trigger fallback — see
  // this file's header comment), so skipped commodities have no UI to show
  // up in. Logging them is what makes a future untracked-commodity gap
  // discoverable later, via this route's own server logs, rather than
  // silent the way the admin upload used to be before this same diagnostic
  // was added there.
  if (skippedCommodities.length > 0) {
    console.warn(
      "[ingest/production-conditions-bulk] skipped untracked commodities:",
      skippedCommodities
    );
  }

  return NextResponse.json({
    status: "success",
    rows_written: rowsWritten,
    skipped_commodities: skippedCommodities,
  });
}
