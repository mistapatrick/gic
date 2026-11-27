import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUserRole, getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/auth/audit";

const ReviewSchema = z.object({ action: z.enum(["publish", "reject"]) });

/**
 * Review action for a single pending manual entry — super_admin only.
 * Uses the signed-in super admin's own RLS-scoped client, not the
 * service-role admin client: the "Super admins review manual entries"
 * update policy (migration 0004) is what actually authorizes this write,
 * so a bug in this route's own role check would still be caught by
 * Postgres rather than silently succeeding via a privileged client.
 *
 * As of 2026-11-27, a super_admin's OWN submission normally never reaches
 * this route pending — POST /api/manual-entries self-publishes it inline
 * (see that route's comment). This route stays the path for reviewing a
 * data_entry account's submission, and the fallback for the rare case
 * where a super_admin's self-publish step itself failed (the entry is left
 * pending rather than lost, visible here like any other pending entry).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const role = await getCurrentUserRole();
  if (!role || role.role !== "super_admin") {
    return NextResponse.json({ error: "Super admin only" }, { status: 403 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ReviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Body must be { action: "publish" | "reject" }' }, { status: 400 });
  }

  const status = parsed.data.action === "publish" ? "published" : "rejected";
  const supabase = await getSupabaseServerClient();

  const { data, error } = await supabase
    .from("manual_data_entries")
    .update({ status, reviewed_by: role.userId, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending") // only a still-pending entry can be reviewed, never re-reviewed silently
    .select("id, domain, status")
    .maybeSingle();

  if (error) {
    await writeAuditLog({
      actorId: role.userId,
      action: "review_manual_entry",
      targetTable: "manual_data_entries",
      targetId: id,
      outcome: "failure",
      changedFields: { error: error.message, status },
    });
    return NextResponse.json({ error: "Failed to update entry" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      { error: "Entry not found, or it is no longer pending" },
      { status: 404 }
    );
  }

  await writeAuditLog({
    actorId: role.userId,
    action: "review_manual_entry",
    targetTable: "manual_data_entries",
    targetId: id,
    outcome: "success",
    changedFields: { status },
  });

  return NextResponse.json({ entry: data });
}
