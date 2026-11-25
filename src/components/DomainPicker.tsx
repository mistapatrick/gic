import React from "react";
import Link from "next/link";
import { CloudRain, Tag, Sprout, Bug, PawPrint, Package, HeartPulse, type LucideIcon } from "lucide-react";

export type DomainStatus = "live" | "preview" | "planned";

interface DomainEntry {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  href: string | null;
  status: DomainStatus;
}

const STATUS_STYLE: Record<DomainStatus, { badge: string; badgeText: string; cardOpacity: string }> = {
  live: { badge: "bg-brand-mint-pale text-brand-teal-dark", badgeText: "Live", cardOpacity: "" },
  preview: { badge: "bg-status-watch-bg text-status-watch", badgeText: "Launching soon", cardOpacity: "" },
  planned: { badge: "bg-brand-grey-green text-brand-muted", badgeText: "Planned", cardOpacity: "opacity-70" },
};

/**
 * The landing page's domain-picker grid — one card per GIC data domain
 * (per the Phase 1 synopsis's module list), each honestly labeled by its
 * real build status rather than presented as uniformly ready:
 *   - "live": the domain's feature flag is on and it has real data.
 *   - "preview": the ingestion/UI is built (Sub-phase 2) but the domain's
 *     feature_flags row is still off, or no backfill has succeeded yet —
 *     still linked, so visiting it shows an honest "not live yet" state
 *     rather than a dead end.
 *   - "planned": no sub-phase has built this domain yet at all (per the
 *     build plan's sub-phase 3-5 scope) — not linked, since there is
 *     nothing real to show.
 * Status for production_conditions/commodity_prices/food_security is
 * resolved by the caller (a server component checking feature_flags) and
 * passed in, since this component itself has no Supabase access.
 */
export function DomainPicker({
  productionConditionsStatus,
  commodityPricesStatus,
  foodSecurityStatus,
}: {
  productionConditionsStatus: DomainStatus;
  commodityPricesStatus: DomainStatus;
  foodSecurityStatus: DomainStatus;
}) {
  const domains: DomainEntry[] = [
    {
      key: "weather",
      label: "Weather",
      description: "Hourly observed telemetry across 24 Nigerian agricultural clusters.",
      icon: CloudRain,
      href: "/weather",
      status: "live",
    },
    {
      key: "commodity_prices",
      label: "Produce prices",
      description: "NBS, World Bank RTFP, and AFEX commodity pricing, reconciled across sources.",
      icon: Tag,
      href: "/commodity-prices",
      status: commodityPricesStatus,
    },
    {
      key: "production_conditions",
      label: "Produce stats",
      description: "FAOSTAT annual production and yield, by commodity.",
      icon: Sprout,
      href: "/production-conditions",
      status: productionConditionsStatus,
    },
    {
      key: "food_security",
      label: "Food security",
      description: "Acute food insecurity (IPC/Cadre Harmonisé) classification by state (HDX HAPI).",
      icon: HeartPulse,
      href: "/food-security",
      status: foodSecurityStatus,
    },
    {
      key: "disease_pest_outbreak",
      label: "Disease & pest outbreak",
      description: "Livestock, aquatic, and crop disease/pest alerts (WAHIS and FAO/CropWatch).",
      icon: Bug,
      href: null,
      status: "planned",
    },
    {
      key: "animals",
      label: "Animals",
      description: "Livestock and fishery production — crop calendar, catfish, tilapia, and more.",
      icon: PawPrint,
      href: null,
      status: "planned",
    },
    {
      key: "inputs",
      label: "Inputs",
      description: "Fertiliser, seedling, herbicide, feed, and animal-medication pricing.",
      icon: Package,
      href: null,
      status: "planned",
    },
  ];

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {domains.map((domain, i) => {
        const style = STATUS_STYLE[domain.status];
        const Icon = domain.icon;
        const card = (
          <div
            className={`gic-animate-in h-full rounded-xl border border-brand-grey-green bg-brand-white p-5 shadow-sm transition hover:border-brand-teal/40 hover:shadow-md ${style.cardOpacity}`}
            style={{ "--gic-delay": `${1.4 + i * 0.08}s` } as React.CSSProperties}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="rounded-lg bg-brand-teal-soft p-2 text-brand-teal">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${style.badge}`}>
                {style.badgeText}
              </span>
            </div>
            <h3 className="mt-3 text-sm font-semibold text-brand-ink">{domain.label}</h3>
            <p className="mt-1 text-xs text-brand-ink-soft">{domain.description}</p>
          </div>
        );

        return (
          <li key={domain.key} className="list-none">
            {domain.href ? (
              <Link href={domain.href} className="block h-full" aria-label={`Open ${domain.label}`}>
                {card}
              </Link>
            ) : (
              <div aria-disabled="true">{card}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
