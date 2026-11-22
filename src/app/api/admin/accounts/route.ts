import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient, getCurrentUserRole } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { validateCreateAccountInput } from "@/lib/auth/accounts-logic";
import { writeAuditLog } from "@/lib/auth/audit";

/**
 * Account management for scoped data-entry personnel. proxy.ts already
 * blocks anything under /api/admin from a non-super_admin or unauthenticated
 * caller, but per the "defense in depth" note there, this route re-checks
 * the role itself rather than assuming the proxy ran correctly — a route
 * handler should never be correct only because something upstream of it
 * was correct.
 */

export async function GET() {
  const role = await getCurrentUserRole();
  if (!role || role.role !== "super_admin") {
    return NextResponse.json({ error: "Super admin only" }, { status: 403 });
  }

  // Reads as the signed-in super admin via the RLS-scoped client — the
  // "Super admins read roles" policy in 0002_auth_roles_audit.sql is what
  // actually authorizes this, not just the check above.
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("user_roles")
    .select("user_id, role, domain_scope, active, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to list accounts" }, { status: 500 });
  }
  return NextResponse.json({ accounts: data });
}

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

  const validation = validateCreateAccountInput(body);
  if (!validation.ok || !validation.data) {
    await writeAuditLog({
      actorId: role.userId,
      action: "create_data_entry_account",
      outcome: "failure",
      changedFields: { error: validation.error },
    });
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { email, domainScope } = validation.data;
  const admin = getSupabaseAdminClient();

  // Creates the auth.users row and emails the invite — no password ever
  // passes through this server or this request. The invited person sets
  // their own password via the link Supabase emails them.
  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email
  );

  if (inviteError || !inviteData.user) {
    await writeAuditLog({
      actorId: role.userId,
      action: "create_data_entry_account",
      targetId: email,
      outcome: "failure",
      changedFields: { error: inviteError?.message ?? "unknown invite error" },
    });
    return NextResponse.json(
      { error: inviteError?.message ?? "Failed to invite user" },
      { status: 502 }
    );
  }

  const { error: roleError } = await admin.from("user_roles").insert({
    user_id: inviteData.user.id,
    role: "data_entry",
    domain_scope: domainScope,
    created_by: role.userId,
    active: true,
  });

  if (roleError) {
    // The auth user now exists with no role row — fail loudly rather than
    // leaving a half-provisioned account that the proxy's "no active
    // role assigned" check would correctly lock out, but which would be a
    // confusing support case. Clean up the orphaned auth user so retrying
    // the request behaves as "create", not "conflict".
    await admin.auth.admin.deleteUser(inviteData.user.id).catch(() => {});
    await writeAuditLog({
      actorId: role.userId,
      action: "create_data_entry_account",
      targetId: email,
      outcome: "failure",
      changedFields: { error: roleError.message },
    });
    return NextResponse.json({ error: "Failed to assign role" }, { status: 500 });
  }

  await writeAuditLog({
    actorId: role.userId,
    action: "create_data_entry_account",
    targetTable: "user_roles",
    targetId: inviteData.user.id,
    outcome: "success",
    changedFields: { email, domainScope },
  });

  return NextResponse.json(
    { userId: inviteData.user.id, email, domainScope, active: true },
    { status: 201 }
  );
}
