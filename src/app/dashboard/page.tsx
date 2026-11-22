import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";

/**
 * Generic post-login landing page. super_admin accounts are sent straight
 * to /admin (account management is their main job here). data_entry
 * accounts land here and see which domain(s) they're scoped to — the
 * actual per-domain manual-entry forms are future-sub-phase work (the
 * domains themselves — input pricing, crop pest tracking — don't exist as
 * data tables yet; only machine-ingested weather telemetry does, which
 * nobody manually enters). This page is the real, working holding point
 * those forms will be added into, not a placeholder route.
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

        <p className="mt-6 text-sm text-brand-muted">
          Manual data-entry forms for your domain(s) will appear here once that
          domain is built. Nothing to do yet.
        </p>
      </div>
    </main>
  );
}
