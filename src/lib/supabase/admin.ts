import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env.server";

/**
 * Service-role Supabase client. Bypasses Row-Level Security — this is the
 * ONLY client in the codebase allowed to write to weather_clusters,
 * observed_hourly, or daily_observed_reports.
 *
 * `import "server-only"` makes it a build error for any "use client"
 * component to import this module (directly or transitively), so the
 * service-role key can never ship to the browser.
 */
export function getSupabaseAdminClient() {
  const env = getServerEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}
