import { isFeatureEnabled } from "@/lib/feature-flags";
import { DomainPageHeader } from "@/components/DomainPageHeader";
import { DomainComingSoon } from "@/components/DomainComingSoon";
import { DomainCardErrorBoundary } from "@/components/DomainCardErrorBoundary";
import { ProductionConditionsCard } from "@/components/ProductionConditionsCard";

export const revalidate = 60;

export default async function ProductionConditionsPage() {
  const enabled = await isFeatureEnabled("production_conditions");

  return (
    <div className="min-h-screen bg-brand-white">
      <DomainPageHeader title="Produce stats" />
      <main className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
        {enabled ? (
          <DomainCardErrorBoundary domainLabel="Production conditions">
            <ProductionConditionsCard />
          </DomainCardErrorBoundary>
        ) : (
          <DomainComingSoon domainLabel="Produce stats" />
        )}
      </main>
    </div>
  );
}
