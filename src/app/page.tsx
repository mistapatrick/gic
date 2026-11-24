import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import GicDashboard from "@/components/GicDashboard";
import { ProductionConditionsCard } from "@/components/ProductionConditionsCard";
import { CommodityPricesCard } from "@/components/CommodityPricesCard";
import { DomainCardErrorBoundary } from "@/components/DomainCardErrorBoundary";
import type { DailyObservedReport } from "@/lib/types";

// ISR fallback alongside Supabase Realtime — a visitor landing between
// Realtime events still sees data no more than a minute stale.
export const revalidate = 60;

export default async function HomePage() {
  const supabase = getSupabaseBrowserClient();
  const { data: latestReport } = await supabase
    .from("daily_observed_reports")
    .select("*")
    .order("obs_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <>
      <GicDashboard initialReport={latestReport as DailyObservedReport | null} />
      {/* Sub-phase 2 domains — siblings of GicDashboard, not children of it,
          so a render failure in either card (each also wrapped in its own
          error boundary) can never affect the weather dashboard above, or
          each other. Both render null while their own feature_flags row is
          off, so this is a no-op until the user flips either flag on. */}
      <div className="mx-auto max-w-6xl space-y-4 px-4 pb-10">
        <DomainCardErrorBoundary domainLabel="Production conditions">
          <ProductionConditionsCard />
        </DomainCardErrorBoundary>
        <DomainCardErrorBoundary domainLabel="Commodity prices">
          <CommodityPricesCard />
        </DomainCardErrorBoundary>
      </div>
    </>
  );
}
