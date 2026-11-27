import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { getCurrentUserRole } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";
import { CommodityPriceEntryForm } from "@/components/CommodityPriceEntryForm";
import { ProductionConditionEntryForm } from "@/components/ProductionConditionEntryForm";

/**
 * Generic post-login landing page. data_entry accounts land here and see
 * which domain(s) they're scoped to, plus the manual-entry form for each
 * domain that has one built: commodity_prices (added Sub-phase 2 — see
 * src/components/CommodityPriceEntryForm.tsx) and production_conditions
 * (added 2026-11-27 — see src/components/ProductionConditionEntryForm.tsx).
 * input_pricing and crop_pest_tracking remain reserved domain names with no
 * form yet (future-sub-phase work) — a staffer scoped only to those sees
 * the "nothing to do yet" message below, unchanged from Sub-phase 1.
 *
 * super_admin used to be redirected straight to /admin and could never
 * land here at all — that blanket redirect is gone as of 2026-11-25, per
 * an explicit requirement that super_admin be able to perform these
 * manual-entry functions directly, not just assign them to other
 * accounts. getCurrentUserRole() now synthesizes a super_admin's
 * domainScope as every domain in DATA_ENTRY_DOMAINS (see that function's
 * own comment in src/lib/supabase/server.ts), so each
 * domainScope.includes(...) check below just works for super_admin with no
 * special case of its own.
 */
export default async function DashboardPage() {
  const role = await getCurrentUserRole();
  if (!role) redirect("/login");

  return (
    <main className="min-h-screen bg-brand-teal-soft px-4 py-10">
      <div className="mx-auto max-w-2xl rounded-xl border border-brand-grey-green bg-brand-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-brand-teal-dark">
              Growthly Intelligence Centre
            </h1>
            <p className="mt-1 text-sm text-brand-muted">Signed in as {role.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {role.role === "super_admin" ? (
              <Link
                href="/admin"
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-teal/30 bg-brand-white px-3 py-1.5 text-xs font-semibold text-brand-teal hover:bg-brand-teal-soft"
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Admin
              </Link>
            ) : null}
            <SignOutButton />
          </div>
        </div>

        <div className="mt-6 rounded-md bg-brand-mint-pale px-4 py-3">
          <p className="text-sm font-medium text-brand-ink">Your data domain(s):</p>
          {role.domainScope.length === 0 ? (
            <p className="mt-1 text-sm text-brand-ink-soft">
              None assigned yet — contact your super admin.
            </p>
          ) : (
            <ul className="mt-1 list-inside list-disc text-sm text-brand-ink-soft">
              {role.domainScope.map((domain) => (
                <li key={domain}>{domain.replace(/_/g, " ")}</li>
              ))}
            </ul>
          )}
        </div>

        {role.domainScope.includes("commodity_prices") && <CommodityPriceEntryForm />}
        {role.domainScope.includes("production_conditions") && <ProductionConditionEntryForm />}
        {!role.domainScope.includes("commodity_prices") &&
          !role.domainScope.includes("production_conditions") && (
            <p className="mt-6 text-sm text-brand-muted">
              Manual data-entry forms for your domain(s) will appear here once that
              domain is built. Nothing to do yet.
            </p>
          )}
      </div>
    </main>
  );
}
