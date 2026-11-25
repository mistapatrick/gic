import { isFeatureEnabled } from "@/lib/feature-flags";
import { DomainPageHeader } from "@/components/DomainPageHeader";
import { DomainComingSoon } from "@/components/DomainComingSoon";
import { DomainCardErrorBoundary } from "@/components/DomainCardErrorBoundary";
import { FoodSecurityCard } from "@/components/FoodSecurityCard";

export const revalidate = 60;

export default async function FoodSecurityPage() {
  const enabled = await isFeatureEnabled("food_security");

  return (
    <div className="min-h-screen bg-brand-white">
      <DomainPageHeader title="Food security" />
      <main className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
        {enabled ? (
          <DomainCardErrorBoundary domainLabel="Food security">
            <FoodSecurityCard />
          </DomainCardErrorBoundary>
        ) : (
          <DomainComingSoon domainLabel="Food security" />
        )}
      </main>
    </div>
  );
}
