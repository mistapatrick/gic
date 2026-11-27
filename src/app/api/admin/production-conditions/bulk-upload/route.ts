import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUserRole } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/auth/audit";
import {
  extractCsvRowsFromZipOrCsv,
  writeProductionConditionsBulkChunkWithDiagnostics,
} from "@/lib/domains/production-conditions/bulk-backfill";

/**
 * Super-admin manual upload for production_conditions — a THIRD,
 * independent path into the same table alongside the live-query route
 * and the scheduled bulk-download route (see bulk-backfill.ts for the
 * shared reasoning). This one exists for when even
 * bulks-faostat.fao.org is unreachable from Vercel/GitHub's own
 * infrastructure specifically (the same kind of origin-side rejection
 * suspected for the live query API) but a human's own browser can still
 * reach FAOSTAT's download page directly — the same "manual-entry
 * treatment like AFEX" fallback already used elsewhere in this codebase
 * for exactly this situation, applied here to a bulk file rather than a
 * single structured data point.
 *
 * Deliberately separate from the existing manual_data_entries /
 * ManualEntryReviewPanel flow (src/app/api/manual-entries/) — that
 * system is a single-row, pending-then-reviewed submission form for a
 * data_entry account's own observations (see entry-schema.ts), a
 * different shape entirely from "parse and upsert an entire file a
 * super_admin already trusts." No separate review step is needed here:
 * the super_admin uploading the file IS the authority, the same
 * standing this route's role check already requires for every other
 * /api/admin/* route.
 *
 * No maxDuration override beyond the project-wide 60s Vercel Hobby
 * ceiling — unlike the scheduled bulk route, this path skips the
 * network-download step entirely (the admin's browser already has the
 * bytes), so the real cost here is unzip + CSV-parse + upsert, not a
 * fetch — comfortably cheaper, though still unverified against a real
 * file from this sandbox.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB — generous for a single-domain FAOSTAT export

export async function POST(request: NextRequest) {
  const role = await getCurrentUserRole();
  if (!role || role.role !== "super_admin") {
    return NextResponse.json({ error: "Super admin only" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with a file field" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided (expected form field "file")' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Uploaded file is empty" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File too large (${Math.round(file.size / 1024 / 1024)}MB) — limit is 50MB` },
      { status: 413 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let rowsWritten: number;
  let skippedCommodities: { itemName: string; count: number }[];
  try {
    const csvRows = extractCsvRowsFromZipOrCsv(buffer);
    const result = await writeProductionConditionsBulkChunkWithDiagnostics(csvRows);
    rowsWritten = result.rowsWritten;
    skippedCommodities = result.skippedCommodities;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse/ingest uploaded file";
    await writeAuditLog({
      actorId: role.userId,
      action: "upload_production_conditions_bulk",
      targetTable: "production_conditions",
      outcome: "failure",
      changedFields: { error: message, fileName: file.name, fileSize: file.size },
    });
    return NextResponse.json({ error: message }, { status: 422 });
  }

  // Surfaced in the audit log too, not just the response — so a skip that
  // nobody notices in the UI in the moment is still visible later when
  // auditing what an upload actually did. See bulk-ingest-logic.ts's
  // SkippedCommodityCount for why this exists: before it, an upload for an
  // untracked commodity (e.g. ginger/plantain/banana/cashew before they
  // were added to TRACKED_COMMODITIES) reported "success" with 0 rows and
  // no trace of why.
  await writeAuditLog({
    actorId: role.userId,
    action: "upload_production_conditions_bulk",
    targetTable: "production_conditions",
    outcome: "success",
    changedFields: { fileName: file.name, fileSize: file.size, rowsWritten, skippedCommodities },
  });

  return NextResponse.json({
    status: "success",
    rows_written: rowsWritten,
    skipped_commodities: skippedCommodities,
  });
}
