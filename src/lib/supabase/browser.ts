import { createBrowserClient } from "@supabase/ssr";

/**
 * Auth-aware browser client. Stores the session in cookies (not
 * localStorage), which is what lets the SSR server client
 * (src/lib/supabase/server.ts) and proxy.ts see the same session on
 * the next request — @supabase/ssr's whole reason to exist is keeping
 * browser and server session state in sync via cookies instead of each
 * side having its own idea of who's signed in.
 *
 * This is a different client from getSupabaseBrowserClient() in
 * client.ts, which is deliberately session-less (persistSession: false)
 * and used only for the public, read-only weather telemetry queries. Never
 * use that one for sign-in/sign-out — it has no cookie wiring and a
 * session created through it would be invisible to the server.
 */
export function getSupabaseAuthBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. Check .env.local against .env.example."
    );
  }

  return createBrowserClient(url, anonKey);
}
