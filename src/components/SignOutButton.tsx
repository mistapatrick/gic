"use client";

import { useRouter } from "next/navigation";
import { getSupabaseAuthBrowserClient } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = getSupabaseAuthBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="rounded-md border border-brand-grey-green px-3 py-1.5 text-sm font-medium text-brand-ink-soft transition hover:bg-brand-teal-soft"
    >
      Sign out
    </button>
  );
}
