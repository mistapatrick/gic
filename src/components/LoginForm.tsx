"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseAuthBrowserClient } from "@/lib/supabase/browser";

/**
 * Email+password sign-in for super_admin and data_entry accounts. Scope for
 * Sub-phase 1: real authentication against Supabase Auth, no password ever
 * touches our own server (signInWithPassword talks straight from the
 * browser to Supabase Auth's API). Password reset / "forgot password" is
 * intentionally out of scope here — see README.md's Sub-phase 1 notes —
 * and can be added without touching this file's structure.
 *
 * Pulled out of app/login/page.tsx so that page can stay a server
 * component that wraps this in <Suspense>: useSearchParams() requires a
 * Suspense boundary for static prerendering, which is only possible if the
 * hook lives in a child component rather than the page itself.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "no_access"
      ? "Your account has no active role assigned. Contact your super admin."
      : null
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = getSupabaseAuthBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setSubmitting(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm rounded-xl border border-brand-grey-green bg-brand-white p-8 shadow-sm"
    >
      <h1 className="text-xl font-semibold text-brand-teal-dark">
        Growthly Intelligence Centre
      </h1>
      <p className="mt-1 text-sm text-brand-muted">Sign in to continue</p>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <label className="mt-6 block text-sm font-medium text-brand-ink-soft" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
      />

      <label className="mt-4 block text-sm font-medium text-brand-ink-soft" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        type="password"
        required
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
      />

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 w-full rounded-md bg-brand-teal px-4 py-2 font-medium text-brand-white transition hover:bg-brand-teal-dark disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>

      <p className="mt-4 text-xs text-brand-muted">
        New accounts are created by your super admin and arrive by email invite —
        there is no self-service sign-up.
      </p>
    </form>
  );
}
