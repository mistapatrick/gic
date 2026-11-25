import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getServerEnv } from "@/lib/env.server";
import { DATA_ENTRY_DOMAINS } from "@/lib/domains/registry";

/**
 * Cookie-aware Supabase client for Server Components and Route Handlers,
 * authenticated as whichever human user's session cookie is on the request.
 *
 * Unlike getSupabaseAdminClient() (service role, bypasses RLS), every query
 * through this client is subject to RLS as that specific user — this is the
 * client every authenticated page/route should use so "can this user see
 * this row" is enforced by Postgres, not by application code remembering to
 * check.
 *
 * Next.js 15+/16 App Router's cookies() is async, so this factory is async.
 */
export async function getSupabaseServerClient() {
  const env = getServerEnv();
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll is called from a Server Component in some code paths,
          // where Next.js forbids mutating cookies. Safe to ignore here:
          // proxy.ts is what actually refreshes the session cookie on
          // every request: see the comment there.
        }
      },
    },
  });
}

/**
 * Looks up the signed-in user's own role row (RLS: "Users read own role
 * row" in 0002_auth_roles_audit.sql lets a user read only their own row).
 * Returns null if there is no session, or no role row exists yet for this
 * user (e.g. an auth.users row created but never granted a role — treated
 * as "no access", not "super admin by default").
 *
 * domainScope synthesis (added 2026-11-25): a super_admin's own
 * user_roles.domain_scope column is always '{}' in the database — the
 * column was only ever meant for data_entry accounts; a super admin's
 * access was historically "full account-management access instead" (see
 * 0002_auth_roles_audit.sql's own comment on that column), not a domain
 * grant. That changed with an explicit requirement that super_admin be
 * able to perform every manual-entry function directly, not only assign
 * it to other accounts — so here, and only here, a super_admin's
 * domainScope is reported as the full DATA_ENTRY_DOMAINS list rather than
 * the raw (empty) column value. Every existing
 * domainScope.includes("...") check in the UI (dashboard/page.tsx) and
 * every RLS policy built on has_domain_scope() (migration 0009) therefore
 * treats a super_admin as scoped to all four domains without either of
 * them needing their own separate "or is_super_admin()" special case.
 */
export async function getCurrentUserRole(): Promise<{
  userId: string;
  email: string | null;
  role: "super_admin" | "data_entry";
  domainScope: string[];
  active: boolean;
} | null> {
  const supabase = await getSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;

  const { data: roleRow, error: roleError } = await supabase
    .from("user_roles")
    .select("role, domain_scope, active")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (roleError || !roleRow || !roleRow.active) return null;

  return {
    userId: userData.user.id,
    email: userData.user.email ?? null,
    role: roleRow.role,
    domainScope: roleRow.role === "super_admin" ? [...DATA_ENTRY_DOMAINS] : roleRow.domain_scope ?? [],
    active: roleRow.active,
  };
}
