import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";
import { CommodityPriceEntryForm } from "@/components/CommodityPriceEntryForm";

/**
 * Generic post-login landing page. super_admin accounts are sent straight
 * to /admin (account management is their main job here). data_entry
 * accounts land here and see which domain(s) they're scoped to, plus the
 * manual-entry form for each domain that has one built (commodity_prices,
 * added in Sub-phase 2 — see src/components/CommodityPriceEntryForm.tsx).
 * input_pricing and crop_pest_tracking remain reserved domain names with
 * no form yet (future-sub-phase work) — a staffer scoped only to those
 * sees the "nothing to do yet" message below, unchanged from Sub-phase 1.
 */
export default async function DashboardPage() {
  const role = await getCurrentUserRole();
  if (!role) redirect("/login");
  if (role.role === "super_admin") redirect("/admin");

  return (
    <main className="min-h-screen bg-brand-teal-soft px-4 py-10">
      <div className="mx-auto max-w-xl rounded-xl border border-brand-grey-green bg-brand-white p-8 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-brand-teal-dark">
              Growthly Intelligence Centre
            </h1>
            <p className="mt-1 text-sm text-brand-muted">Signed in as {role.email}</p>
          </div>
          <SignOutButton />
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

        {role.domainScope.includes("commodity_prices") ? (
          <CommodityPriceEntryForm />
        ) : (
          <p className="mt-6 text-sm text-brand-muted">
            Manual data-entry forms for your domain(s) will appear here once that
            domain is built. Nothing to do yet.
          </p>
        )}
      </div>
    </main>
  );
}
