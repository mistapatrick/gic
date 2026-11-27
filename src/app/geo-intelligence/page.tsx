import { isFeatureEnabled } from "@/lib/feature-flags";
import { DomainPageHeader } from "@/components/DomainPageHeader";
import { DomainComingSoon } from "@/components/DomainComingSoon";
import { DomainCardErrorBoundary } from "@/components/DomainCardErrorBoundary";
import { GeoIntelligenceCard } from "@/components/GeoIntelligenceCard";

export const revalidate = 60;

export default async function GeoIntelligencePage() {
  const enabled = await isFeatureEnabled("geo_intelligence");

  return (
    <div className="min-h-screen bg-brand-white">
      <DomainPageHeader title="Geo intelligence" />
      <main className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
        {enabled ? (
          <DomainCardErrorBoundary domainLabel="Geo intelligence">
            <GeoIntelligenceCard />
          </DomainCardErrorBoundary>
        ) : (
          <DomainComingSoon domainLabel="Geo intelligence" />
        )}
      </main>
    </div>
  );
}
