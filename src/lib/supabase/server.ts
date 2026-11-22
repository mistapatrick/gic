import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getServerEnv } from "@/lib/env.server";

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
    domainScope: roleRow.domain_scope ?? [],
    active: roleRow.active,
  };
}
