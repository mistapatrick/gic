import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUserRole } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getBackfillAdapter } from "@/lib/ingestion/domain-adapters";
import { validateStartBackfillInput } from "@/lib/ingestion/backfill-request";
import { runBackfillTick, type BackfillJobState } from "@/lib/ingestion/backfill-framework";
import { writeAuditLog } from "@/lib/auth/audit";

// Same Vercel Hobby ceiling as /api/ingest. runBackfillTick's own
// timeBudgetMs (default 45s) leaves margin under this for request/response
// overhead and the final progress write, so a tick returns cleanly instead
// of getting hard-killed mid-chunk.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface BackfillJobRow {
  domain: string;
  range_start: string;
  range_end: string;
  cursor_date: string;
  chunk_size_days: number;
  status: BackfillJobState["status"];
  rows_written: number;
  last_error: string | null;
}

function rowToState(row: BackfillJobRow): BackfillJobState {
  return {
    domain: row.domain,
    rangeStart: row.range_start,
    rangeEnd: row.range_end,
    cursorDate: row.cursor_date,
    chunkSizeDays: row.chunk_size_days,
    status: row.status,
    rowsWritten: row.rows_written,
    lastError: row.last_error,
  };
}

/**
 * Starts a new historical-backfill job, or — calling this again with the
 * same domain/range while a job is still "running" or "pending" — resumes
 * it for one more time-boxed tick. A multi-year backfill needs many POSTs;
 * see README.md for the GitHub Actions workflow that loops this
 * automatically, or call it by hand / on a schedule.
 */
export async function POST(request: NextRequest) {
  const role = await getCurrentUserRole();
  if (!role || role.role !== "super_admin") {
    return NextResponse.json({ error: "Super admin only" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateStartBackfillInput(body);
  if (!validation.ok || !validation.data) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const { domain, rangeStart, rangeEnd, chunkSizeDays } = validation.data;

  const adapter = await getBackfillAdapter(domain).catch((err) => {
    console.error(`[backfill] failed to load adapter for domain "${domain}":`, err);
    return null;
  });
  if (!adapter) {
    return NextResponse.json({ error: `No backfill adapter available for "${domain}"` }, { status: 502 });
  }

  const admin = getSupabaseAdminClient();

  // Find-or-create the job row for this exact (domain, range). The unique
  // constraint on (domain, range_start, range_end) means a second POST with
  // the same range resumes the same row rather than creating a duplicate.
  const { data: existing } = await admin
    .from("backfill_jobs")
    .select("*")
    .eq("domain", domain)
    .eq("range_start", rangeStart)
    .eq("range_end", rangeEnd)
    .maybeSingle();

  let jobRow = existing as BackfillJobRow | null;

  if (!jobRow) {
    const { data: created, error: createErr } = await admin
      .from("backfill_jobs")
      .insert({
        domain,
        range_start: rangeStart,
        range_end: rangeEnd,
        cursor_date: rangeStart,
        chunk_size_days: chunkSizeDays,
        status: "pending",
        created_by: role.userId,
      })
      .select("*")
      .single();

    if (createErr || !created) {
      return NextResponse.json({ error: "Failed to create backfill job" }, { status: 500 });
    }
    jobRow = created as BackfillJobRow;
  }

  if (jobRow.status === "completed") {
    return NextResponse.json({ job: rowToState(jobRow) });
  }

  const finalState = await runBackfillTick({
    job: rowToState(jobRow),
    fetchChunk: adapter.fetchChunk,
    writeChunk: adapter.writeChunk,
    persistProgress: async (state) => {
      await admin
        .from("backfill_jobs")
        .update({
          cursor_date: state.cursorDate,
          status: state.status,
          rows_written: state.rowsWritten,
          last_error: state.lastError,
          updated_at: new Date().toISOString(),
        })
        .eq("domain", state.domain)
        .eq("range_start", state.rangeStart)
        .eq("range_end", state.rangeEnd);
    },
  });

  await writeAuditLog({
    actorId: role.userId,
    action: "backfill_tick",
    targetTable: "backfill_jobs",
    targetId: `${domain}:${rangeStart}:${rangeEnd}`,
    outcome: finalState.status === "failed" ? "failure" : "success",
    changedFields: {
      cursorDate: finalState.cursorDate,
      status: finalState.status,
      rowsWritten: finalState.rowsWritten,
      lastError: finalState.lastError,
    },
  });

  return NextResponse.json({ job: finalState });
}

export async function GET(request: NextRequest) {
  const role = await getCurrentUserRole();
  if (!role || role.role !== "super_admin") {
    return NextResponse.json({ error: "Super admin only" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain");
  const rangeStart = searchParams.get("rangeStart");
  const rangeEnd = searchParams.get("rangeEnd");

  const admin = getSupabaseAdminClient();

  if (domain && rangeStart && rangeEnd) {
    const { data } = await admin
      .from("backfill_jobs")
      .select("*")
      .eq("domain", domain)
      .eq("range_start", rangeStart)
      .eq("range_end", rangeEnd)
      .maybeSingle();
    return NextResponse.json({ job: data ? rowToState(data as BackfillJobRow) : null });
  }

  const { data } = await admin
    .from("backfill_jobs")
    .select("*")
    .order("updated_at", { ascending: false });
  return NextResponse.json({ jobs: (data as BackfillJobRow[] | null ?? []).map(rowToState) });
}
