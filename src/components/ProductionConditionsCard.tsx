"use client";

import { useEffect, useState } from "react";
import { Sparkles, Sprout } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  CROP_CATEGORIES,
  getCropCategory,
  getCropEmoji,
} from "@/lib/domains/production-conditions/crop-emoji";

type ProductionMetric =
  | "production_quantity"
  | "yield"
  | "area_harvested"
  | "stocks"
  | "producing_animals_slaughtered";

interface ProductionRow {
  commodity: string;
  metric: ProductionMetric;
  value: number;
  unit: string;
  year: number;
}

interface ProductionBrief {
  national_summary: string;
  standout_insights: string[];
}

interface SecondaryStat {
  label: string;
  value: number;
  unit: string;
}

interface CommodityCardData {
  commodity: string;
  value: number;
  unit: string;
  year: number;
  secondaryStats: SecondaryStat[];
}

// Secondary stats shown under the headline production figure, in display
// order. "stocks" and "producing_animals_slaughtered" only ever have values
// for the two livestock-product commodities (Cattle meat, Cow milk) — see
// ingest-logic.ts's ELEMENT_METRIC_RULES — so most crop cards simply show
// Yield and nothing else.
const SECONDARY_METRICS: Array<{ metric: ProductionMetric; label: string }> = [
  { metric: "yield", label: "Yield" },
  { metric: "stocks", label: "Stocks" },
  { metric: "producing_animals_slaughtered", label: "Slaughtered" },
];

/**
 * Public dashboard card for the production_conditions domain (FAOSTAT —
 * see src/lib/domains/production-conditions/). Reads directly via the
 * anon browser client against the public "Public read production
 * conditions" RLS policy — no server component/API route needed for the
 * figures themselves, same pattern the rest of the public dashboard already
 * uses for weather. The AI synthesis panel is the one exception: it calls
 * /api/production-conditions-brief (see that route for why this is a
 * read-time, hourly-cached synthesis rather than one generated and stored
 * at ingestion time, unlike weather's).
 *
 * Styled to match the weather page's telemetry cards (KpiCard/ChartCard in
 * GicDashboard.tsx) and its AI synthesis panel (AgentBriefPanel.tsx) rather
 * than the plain list this card used to be, per explicit design feedback
 * that the original list rendering was "bland" with "nothing exciting to
 * the eyes" and no AI synthesis.
 *
 * Hidden entirely (renders null) while feature_flags.production_conditions
 * is false, which it stays until the user verifies a real backfill run in
 * their own deployed environment (see migration 0004's comment on why
 * that default is deliberately cautious) — this card existing in the
 * bundle is not the same as it being visible.
 */
export function ProductionConditionsCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ProductionRow[]>([]);
  const [brief, setBrief] = useState<ProductionBrief | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const flagOn = await isFeatureEnabled("production_conditions");
      if (cancelled) return;
      setEnabled(flagOn);
      if (!flagOn) return;

      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: fetchError } = await supabase
          .from("production_conditions")
          .select("commodity, metric, value, unit, year")
          .in("metric", [
            "production_quantity",
            "yield",
            "area_harvested",
            "stocks",
            "producing_animals_slaughtered",
          ])
          .eq("region", "National")
          .order("year", { ascending: false });

        if (cancelled) return;
        if (fetchError) {
          setError("Could not load production conditions data.");
          return;
        }
        setRows((data as ProductionRow[]) ?? []);
      } catch {
        if (!cancelled) setError("Could not load production conditions data.");
      }

      // The AI synthesis is a non-critical enhancement on top of the figures
      // above: a slow or failed fetch here never blocks or errors the
      // per-commodity cards, it just leaves the synthesis panel showing its
      // "generating" placeholder.
      try {
        const res = await fetch("/api/production-conditions-brief");
        if (cancelled) return;
        if (res.ok) {
          setBrief((await res.json()) as ProductionBrief);
        }
      } catch {
        // Figures still render without a synthesis — nothing to surface here.
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (enabled === null || enabled === false) return null;

  // Keep only each commodity's most recent year, independently per metric
  // (production_quantity, yield, area_harvested, stocks and
  // producing_animals_slaughtered don't always share the same latest year
  // in FAOSTAT's release schedule).
  const latestByCommodityMetric = new Map<string, ProductionRow>();
  for (const row of rows) {
    const key = `${row.commodity}__${row.metric}`;
    if (!latestByCommodityMetric.has(key)) latestByCommodityMetric.set(key, row);
  }

  const cards = new Map<string, CommodityCardData>();
  for (const row of latestByCommodityMetric.values()) {
    if (row.metric !== "production_quantity") continue;
    cards.set(row.commodity, {
      commodity: row.commodity,
      value: row.value,
      unit: row.unit,
      year: row.year,
      secondaryStats: [],
    });
  }
  for (const { metric, label } of SECONDARY_METRICS) {
    for (const row of latestByCommodityMetric.values()) {
      if (row.metric !== metric) continue;
      const card = cards.get(row.commodity);
      if (card) card.secondaryStats.push({ label, value: row.value, unit: row.unit });
    }
  }

  const cardList = Array.from(cards.values()).sort((a, b) => b.value - a.value);
  const byCategory = new Map<string, CommodityCardData[]>();
  for (const card of cardList) {
    const category = getCropCategory(card.commodity);
    const list = byCategory.get(category) ?? [];
    list.push(card);
    byCategory.set(category, list);
  }

  return (
    <div className="rounded-xl border border-brand-grey-green bg-brand-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <Sprout className="h-5 w-5 text-brand-teal" aria-hidden="true" />
        <h2 className="text-base font-semibold text-brand-teal-dark">Production conditions</h2>
      </div>
      <p className="mt-1 text-sm text-brand-muted">
        Most recent annual production per tracked commodity, nationally (source: FAOSTAT).
      </p>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!error && cardList.length === 0 ? (
        <p className="mt-4 text-sm text-brand-muted">No production data ingested yet.</p>
      ) : (
        !error && (
          <>
            {/* AI synthesis panel — same visual language as the weather
                page's AgentBriefPanel. */}
            <section className="mt-4 rounded-xl border border-brand-grey-green bg-brand-mint-pale/40 p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand-teal" aria-hidden="true" />
                <span className="text-xs font-bold uppercase tracking-wider text-brand-teal">
                  AI Production Synthesis
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-brand-ink">
                {brief?.national_summary ?? "Generating the latest production synthesis…"}
              </p>
              {brief && brief.standout_insights.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {brief.standout_insights.map((insight, i) => (
                    <li
                      key={i}
                      className="rounded-full border border-brand-teal/30 bg-brand-white px-2.5 py-1 text-[11px] font-medium text-brand-ink-soft"
                    >
                      {insight}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {CROP_CATEGORIES.map((category) => {
              const items = byCategory.get(category);
              if (!items || items.length === 0) return null;
              return (
                <section key={category} className="mt-5">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-brand-muted">
                    {category}
                  </h3>
                  <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                    {items.map((card) => (
                      <CommodityCard key={card.commodity} card={card} />
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        )
      )}
    </div>
  );
}

function CommodityCard({ card }: { card: CommodityCardData }) {
  return (
    <div className="rounded-xl border border-brand-grey-green bg-brand-white p-3">
      <div className="flex items-center gap-1.5">
        <span className="text-xl" aria-hidden="true">
          {getCropEmoji(card.commodity)}
        </span>
        <span className="truncate text-xs font-semibold text-brand-ink">{card.commodity}</span>
      </div>
      <div className="mt-1.5 text-base font-bold text-brand-ink sm:text-lg">
        {card.value.toLocaleString()}{" "}
        <span className="text-xs font-medium text-brand-ink-soft">{card.unit}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-brand-ink-soft">{card.year}</div>
      {card.secondaryStats.map((stat) => (
        <div key={stat.label} className="text-[11px] text-brand-ink-soft">
          {stat.label}: {stat.value.toLocaleString()} {stat.unit}
        </div>
      ))}
    </div>
  );
}
