import { redirect } from "next/navigation";
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
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-brand-teal-dark">
              Account administration
            </h1>
            <p className="mt-1 text-sm text-brand-muted">Signed in as {role.email}</p>
          </div>
          <SignOutButton />
        </div>

        <AdminAccountsPanel initialAccounts={accounts ?? []} />

        <div className="mt-6">
          <BackfillPanel domains={BACKFILL_DOMAINS} />
        </div>

        <div className="mt-6">
          <ProductionConditionsBulkUploadPanel />
        </div>

        <div className="mt-6">
          <ManualEntryReviewPanel />
        </div>
      </div>
    </main>
  );
}
