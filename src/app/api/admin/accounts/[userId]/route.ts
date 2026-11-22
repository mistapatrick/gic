import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUserRole } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/auth/audit";

const PatchSchema = z.object({ active: z.boolean() });

/**
 * Deactivate or reactivate an existing account. Deliberately no DELETE:
 * removing the auth.users row would orphan every audit_log row that names
 * them as actor_id (the column is nullable specifically so a deleted
 * user's history can't be rewritten by deleting them), so account
 * lifecycle here is "active" on/off, never a hard delete.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const role = await getCurrentUserRole();
  if (!role || role.role !== "super_admin") {
    return NextResponse.json({ error: "Super admin only" }, { status: 403 });
  }

  const { userId } = await params;

  if (userId === role.userId) {
    return NextResponse.json(
      { error: "You cannot change your own account's active status here" },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Body must be { active: boolean }" }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  const { error } = await admin
    .from("user_roles")
    .update({ active: parsed.data.active })
    .eq("user_id", userId);

  if (error) {
    await writeAuditLog({
      actorId: role.userId,
      action: "set_account_active",
      targetTable: "user_roles",
      targetId: userId,
      outcome: "failure",
      changedFields: { error: error.message },
    });
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }

  await writeAuditLog({
    actorId: role.userId,
    action: "set_account_active",
    targetTable: "user_roles",
    targetId: userId,
    outcome: "success",
    changedFields: { active: parsed.data.active },
  });

  return NextResponse.json({ userId, active: parsed.data.active });
}
