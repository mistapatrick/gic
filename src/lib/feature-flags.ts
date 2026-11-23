import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Checks one feature_flags row via the public read-only anon client (the
 * "Public read feature flags" RLS policy in 0002_auth_roles_audit.sql
 * grants select-only to anyone — no auth required, matching the kill-switch
 * purpose: the public dashboard itself needs to check this before rendering
 * a domain's card). Defaults to disabled on any failure (missing row,
 * network error, misconfigured env) — a flag check that can't complete
 * should never fail open.
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("feature_flags")
      .select("enabled")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return false;
    return data.enabled === true;
  } catch {
    return false;
  }
}
