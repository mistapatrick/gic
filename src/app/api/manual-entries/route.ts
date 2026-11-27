import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUserRole, getSupabaseServerClient } from "@/lib/supabase/server";
import { validateManualEntrySubmission } from "@/lib/domains/manual-entries/submission";
import { writeAuditLog } from "@/lib/auth/audit";

/**
 * Generic manual-entry submission + listing surface, shared by every
 * manual-entry domain (commodity_prices and, as of 2026-11-27,
 * production_conditions too; input_pricing, crop_pest_tracking later) —
 * see migration 0004_production_conditions_and_manual_entries.sql and
 * src/lib/domains/manual-entries/.
 *
 * src/proxy.ts already requires any caller here to be authenticated with
 * an active role before the request reaches this file; per the same
 * "defense in depth, never trust the proxy alone" note on
 * src/app/api/admin/accounts/route.ts, this route re-checks anyway.
 *
 * Both GET and POST use the signed-in user's own RLS-scoped client
 * (getSupabaseServerClient()), not the service-role admin client — unlike
 * most of this codebase's writes (production_conditions, backfill_jobs,
 * user_roles), manual_data_entries has real per-role RLS policies built
 * for exactly these two operations (insert-as-self-pending,
 * read-own-or-all), so Postgres is the actual enforcer here, not just this
 * route's own role check.
 *
 * Fixed 2026-11-27: this handler used to reject any caller whose role
 * wasn't literally "data_entry" — a bug introduced the moment
 * getCurrentUserRole() started synthesizing a super_admin's domainScope as
 * every DATA_ENTRY_DOMAINS value (2026-11-25's UI/UX overhaul). That change
 * made /dashboard render CommodityPriceEntryForm for a super_admin, but
 * this route would still 403 the submission with "Only data-entry accounts
 * submit manual entries" — never actually exercised until the user asked
 * for a super-admin manual-entry path and it turned out submission itself
 * was already silently broken. Fixed below by accepting both roles and
 * relying on the same domainScope/has_domain_scope() check that already
 * protected a data_entry account's own domain boundary.
 */

export async function POST(request: NextRequest) {
  const role = await getCurrentUserRole();
  if (!role) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateManualEntrySubmission(body);
  if (!validation.ok || !validation.data) {
    await writeAuditLog({
      actorId: role.userId,
      action: "submit_manual_entry",
      outcome: "failure",
      changedFields: { error: validation.error },
    });
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { domain, entryDate, sourceNote, payload } = validation.data;

  // App-layer check before the DB round-trip — has_domain_scope(domain) in
  // the insert policy enforces the same rule, but failing fast here with a
  // clear message avoids a confusing generic RLS-denial error for the
  // common case of a staffer not scoped to the domain they tried to use.
  if (!role.domainScope.includes(domain)) {
    await writeAuditLog({
      actorId: role.userId,
      action: "submit_manual_entry",
      targetTable: "manual_data_entries",
      outcome: "failure",
      changedFields: { error: `Not scoped to domain "${domain}"`, domain },
    });
    return NextResponse.json({ error: `You are not scoped to domain "${domain}"` }, { status: 403 });
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("manual_data_entries")
    .insert({
      domain,
      entry_date: entryDate,
      entered_by: role.userId,
      source_note: sourceNote ?? null,
      payload,
      // status is NOT set here — it defaults to 'pending' at the column
      // level, and the insert RLS policy's WITH CHECK independently
      // requires status = 'pending' too, so even a modified client request
      // couldn't make an entry land already published.
    })
    .select("id, domain, entry_date, status, created_at")
    .single();

  if (error) {
    await writeAuditLog({
      actorId: role.userId,
      action: "submit_manual_entry",
      targetTable: "manual_data_entries",
      outcome: "failure",
      changedFields: { error: error.message, domain },
    });
    return NextResponse.json({ error: "Failed to save entry" }, { status: 500 });
  }

  await writeAuditLog({
    actorId: role.userId,
    action: "submit_manual_entry",
    targetTable: "manual_data_entries",
    targetId: String(data.id),
    outcome: "success",
    changedFields: { domain, entryDate },
  });

  // Self-publish: a super_admin's own submission goes live immediately
  // rather than sitting pending for a review that would just be the same
  // person approving their own entry a second time. This reuses the exact
  // update the PATCH review route performs ([id]/route.ts) — same RLS
  // policy ("Super admins review manual entries"), same columns set — just
  // triggered inline instead of requiring a separate click. A data_entry
  // account's submission is untouched by this and still lands pending,
  // awaiting a super_admin's review as before.
  if (role.role === "super_admin") {
    const { data: published, error: publishError } = await supabase
      .from("manual_data_entries")
      .update({ status: "published", reviewed_by: role.userId, reviewed_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "pending")
      .select("id, domain, entry_date, status, created_at")
      .maybeSingle();

    if (publishError || !published) {
      // Not lost — the entry is still saved as pending, same as any
      // data_entry submission, just needing a manual publish from /admin
      // (or a retry) instead of the usual instant self-publish.
      await writeAuditLog({
        actorId: role.userId,
        action: "review_manual_entry",
        targetTable: "manual_data_entries",
        targetId: String(data.id),
        outcome: "failure",
        changedFields: { error: publishError?.message ?? "No row updated", status: "published" },
      });
      return NextResponse.json({ entry: data }, { status: 201 });
    }

    await writeAuditLog({
      actorId: role.userId,
      action: "review_manual_entry",
      targetTable: "manual_data_entries",
      targetId: String(data.id),
      outcome: "success",
      changedFields: { status: "published", selfPublished: true },
    });

    return NextResponse.json({ entry: published }, { status: 201 });
  }

  return NextResponse.json({ entry: data }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const role = await getCurrentUserRole();
  if (!role) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain");
  const status = searchParams.get("status");

  const supabase = await getSupabaseServerClient();
  let query = supabase
    .from("manual_data_entries")
    .select("id, domain, payload, entry_date, entered_by, source_note, status, reviewed_by, reviewed_at, created_at")
    .order("created_at", { ascending: false });

  if (domain) query = query.eq("domain", domain);
  if (status) query = query.eq("status", status);

  // No further filtering by role here — which rows actually come back is
  // decided by Postgres RLS (own rows for data_entry, every row for
  // super_admin, see migration 0004), not by this query.
  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Failed to list entries" }, { status: 500 });
  }
  return NextResponse.json({ entries: data });
}
