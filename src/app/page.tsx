import type { CSSProperties } from "react";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { GicHero } from "@/components/GicHero";
import { IntelligenceFormula } from "@/components/IntelligenceFormula";
import { DomainPicker, type DomainStatus } from "@/components/DomainPicker";

export const revalidate = 60;

/**
 * GIC's landing page — introduces the product and its core idea (data +
 * insight + analytics + modelling + adaptation = intelligence), then hands
 * off to a domain picker so the user chooses what they want (weather,
 * produce prices, produce stats, and so on), each domain now living on its
 * own page. Replaces the previous "/" , which mounted the weather dashboard
 * directly — that content now lives at /weather (see that page's own
 * comment for why).
 */
export default async function HomePage() {
  const [productionConditionsEnabled, commodityPricesEnabled, foodSecurityEnabled] = await Promise.all([
    isFeatureEnabled("production_conditions"),
    isFeatureEnabled("commodity_prices"),
    isFeatureEnabled("food_security"),
  ]);

  // Built (Sub-phase 2) but not yet verified live in this deployment is
  // "preview", not "planned" — the distinction DomainPicker's own comment
  // documents, and the one this landing page needs to get right rather than
  // lumping every non-live domain together as equally unbuilt.
  const productionConditionsStatus: DomainStatus = productionConditionsEnabled ? "live" : "preview";
  const commodityPricesStatus: DomainStatus = commodityPricesEnabled ? "live" : "preview";
  const foodSecurityStatus: DomainStatus = foodSecurityEnabled ? "live" : "preview";

  return (
    <div className="min-h-screen bg-brand-white">
      <main className="mx-auto flex max-w-5xl flex-col items-center px-4 py-12 text-center lg:px-8">
        <div className="gic-animate-in" style={{ "--gic-delay": "0s" } as CSSProperties}>
          <GicHero />
        </div>

        <p
          className="gic-animate-in mt-6 max-w-xl text-sm text-brand-ink-soft sm:text-base"
          style={{ "--gic-delay": "0.15s" } as CSSProperties}
        >
          Nigeria&apos;s agricultural data, interpreted — not just reported. GIC turns raw
          observations into a decision, one domain at a time.
        </p>

        <div className="mt-10 w-full">
          <IntelligenceFormula />
        </div>

        <h2
          className="gic-animate-in mt-14 text-sm font-semibold uppercase tracking-wide text-brand-muted"
          style={{ "--gic-delay": "1.3s" } as CSSProperties}
        >
          Choose what you want to see
        </h2>

        <div className="mt-5 w-full pb-10">
          <DomainPicker
            productionConditionsStatus={productionConditionsStatus}
            commodityPricesStatus={commodityPricesStatus}
            foodSecurityStatus={foodSecurityStatus}
          />
        </div>
      </main>
    </div>
  );
}
