import { isFeatureEnabled } from "@/lib/feature-flags";
import { DomainPageHeader } from "@/components/DomainPageHeader";
import { DomainComingSoon } from "@/components/DomainComingSoon";
import { DomainCardErrorBoundary } from "@/components/DomainCardErrorBoundary";
import { CommodityPricesCard } from "@/components/CommodityPricesCard";

export const revalidate = 60;

export default async function CommodityPricesPage() {
  const enabled = await isFeatureEnabled("commodity_prices");

  return (
    <div className="min-h-screen bg-brand-white">
      <DomainPageHeader title="Produce prices" />
      <main className="mx-auto max-w-5xl px-4 py-8 lg:px-8">
        {enabled ? (
          <DomainCardErrorBoundary domainLabel="Commodity prices">
            <CommodityPricesCard />
          </DomainCardErrorBoundary>
        ) : (
          <DomainComingSoon domainLabel="Produce prices" />
        )}
      </main>
    </div>
  );
}
