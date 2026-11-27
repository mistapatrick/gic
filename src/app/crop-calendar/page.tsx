import { isFeatureEnabled } from "@/lib/feature-flags";
import { DomainPageHeader } from "@/components/DomainPageHeader";
import { DomainComingSoon } from "@/components/DomainComingSoon";
import { DomainCardErrorBoundary } from "@/components/DomainCardErrorBoundary";
import { CropCalendarCard } from "@/components/CropCalendarCard";

export const revalidate = 60;

export default async function CropCalendarPage() {
  const enabled = await isFeatureEnabled("crop_calendar");

  return (
    <div className="min-h-screen bg-brand-white">
      <DomainPageHeader title="Crop calendar" />
      <main className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
        {enabled ? (
          <DomainCardErrorBoundary domainLabel="Crop calendar">
            <CropCalendarCard />
          </DomainCardErrorBoundary>
        ) : (
          <DomainComingSoon domainLabel="Crop calendar" />
        )}
      </main>
    </div>
  );
}
