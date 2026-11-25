import { redirect } from "next/navigation";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { getCurrentUserRole, getSupabaseServerClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";
import { AdminAccountsPanel } from "@/components/AdminAccountsPanel";
import { BackfillPanel } from "@/components/BackfillPanel";
import { ManualEntryReviewPanel } from "@/components/ManualEntryReviewPanel";
import { ProductionConditionsBulkUploadPanel } from "@/components/ProductionConditionsBulkUploadPanel";
import { BACKFILL_DOMAINS } from "@/lib/ingestion/domain-adapters";

export default async function AdminPage() {
  const role = await getCurrentUserRole();
  if (!role) redirect("/login");
  if (role.role !== "super_admin") redirect("/dashboard");

  // Initial list fetched server-side (as this super admin, under RLS) so
  // the page has content on first paint; AdminAccountsPanel re-fetches via
  // the API route after any create/deactivate action.
  const supabase = await getSupabaseServerClient();
  const { data: accounts } = await supabase
    .from("user_roles")
    .select("user_id, role, domain_scope, active, created_at")
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-brand-teal-soft px-4 py-10">
      {/* Widened from max-w-3xl and the panels below moved into a 2-column
       * grid at lg:+ (2026-11-25) — the previous single stacked column
       * left most of a wide monitor empty no matter how tall the page got.
       * AdminAccountsPanel and ManualEntryReviewPanel stay full-width
       * since both are list/table-shaped and benefit more from width than
       * from sitting beside something else. */}
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-brand-teal-dark">
              Account administration
            </h1>
            <p className="mt-1 text-sm text-brand-muted">Signed in as {role.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-teal/30 bg-brand-white px-3 py-1.5 text-xs font-semibold text-brand-teal hover:bg-brand-teal-soft"
            >
              <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
              Data entry forms
            </Link>
            <SignOutButton />
          </div>
        </div>

        <AdminAccountsPanel initialAccounts={accounts ?? []} />

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <BackfillPanel domains={BACKFILL_DOMAINS} />
          <ProductionConditionsBulkUploadPanel />
        </div>

        <div className="mt-6">
          <ManualEntryReviewPanel />
        </div>
      </div>
    </main>
  );
}
