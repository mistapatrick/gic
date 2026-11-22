import { createClient } from "@supabase/supabase-js";

/**
 * Browser/server-component read-only Supabase client, authenticated with the
 * anon key. Safe to import from "use client" components: the anon key can
 * only ever SELECT, because every table's RLS policy grants read access only
 * (see supabase/schema.sql) — there is no write path through this client.
 */
export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. Check .env.local against .env.example."
    );
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false },
  });
}
