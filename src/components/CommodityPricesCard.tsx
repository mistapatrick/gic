"use client";

import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  reconcileCommodityPrices,
  normalizeManualCommodityEntry,
  type NormalizedPriceObservation,
  type ReconciledCommodityPrice,
} from "@/lib/domains/commodity-prices/price-types";
import type { CommodityPriceEntryPayload } from "@/lib/domains/commodity-prices/entry-schema";
import { ScenarioPanel } from "@/components/ScenarioPanel";
import type { ScenarioSet } from "@/lib/scenarios/scenario-logic";

interface ObservationRow {
  commodity: string;
  source: string;
  price_type: string;
  value: number;
  unit: string;
  currency: string;
  period_date: string;
  region: string;
  raw_item_label: string | null;
}

interface PublishedManualEntry {
  entry_date: string;
  payload: CommodityPriceEntryPayload;
}

// Generous enough to cover the latest period for every (commodity, source)
// combination this domain tracks (15 commodities x up to 2 automated
// sources), without needing a "latest per group" database view —
// reconcileCommodityPrices itself narrows this down to one observation per
// source per group.
const RECENT_OBSERVATIONS_LIMIT = 500;
const RECENT_MANUAL_ENTRIES_LIMIT = 100;

/**
 * Public dashboard card for commodity_prices, now a mix of automated
 * sources (NBS, World Bank RTFP, FEWS NET — commodity_price_observations)
 * and a manual one (AFEX, and any ad hoc "OTHER" entry —
 * manual_data_entries, status='published' only). Both are fetched via the
 * anon browser client against their respective public-read RLS policies,
 * normalized into one shape, and reconciled: each source's own figure
 * stays visible, with a cross-agency average shown only where sources
 * measuring the same thing (retail prices) agree on commodity/unit —
 * AFEX's exchange spot price is never blended into that average, since it
 * measures a structurally different thing. Hidden entirely while
 * feature_flags.commodity_prices is false.
 *
 * FEWS_NET rows get a SECOND, independent gate
 * (feature_flags.commodity_prices_fewsnet) on top of the domain-wide flag
 * above: the weekly ingest writes them regardless, but they're filtered
 * out of what this card actually reconciles and displays until that flag
 * is separately switched on — the user's explicit request, so FEWS NET
 * data can accumulate for review without silently entering the public
 * reconciled average the moment the broader commodity_prices flag goes
 * live for NBS/World Bank RTFP.
 */
function groupKey(g: { commodity: string; priceType: string; unit: string; currency: string; region: string }): string {
  return `${g.commodity}::${g.priceType}::${g.unit}::${g.currency}::${g.region}`;
}

export function CommodityPricesCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [scenariosEnabled, setScenariosEnabled] = useState(false);
  const [reconciled, setReconciled] = useState<ReconciledCommodityPrice[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Sub-phase 6 Step 2 pilot — see ProductionConditionsCard.tsx's identical
  // pattern for the reasoning (one group in flight/shown at a time,
  // user-triggered only). A "group" here is keyed by groupKey() rather than
  // commodity alone, since a commodity can have more than one reconciled
  // group (e.g. AFEX's exchange-spot price alongside NBS/World Bank RTFP's
  // retail price) that must never be modeled together.
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const [activeCommodityLabel, setActiveCommodityLabel] = useState<string | null>(null);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [scenarioData, setScenarioData] = useState<ScenarioSet | null>(null);

  async function handleGenerateScenario(group: ReconciledCommodityPrice) {
    setActiveGroupKey(groupKey(group));
    setActiveCommodityLabel(group.commodity);
    setScenarioLoading(true);
    setScenarioError(null);
    setScenarioData(null);
    try {
      const res = await fetch("/api/scenarios/commodity-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commodity: group.commodity,
          priceType: group.priceType,
          unit: group.unit,
          currency: group.currency,
          region: group.region,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setScenarioError(body.error ?? "Could not model scenarios for this commodity.");
        return;
      }
      setScenarioData(body as ScenarioSet);
    } catch {
      setScenarioError("Could not reach the scenario modeling service.");
    } finally {
      setScenarioLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [flagOn, fewsNetOn, scenariosFlagOn] = await Promise.all([
        isFeatureEnabled("commodity_prices"),
        isFeatureEnabled("commodity_prices_fewsnet"),
        isFeatureEnabled("commodity_prices_scenarios"),
      ]);
      if (cancelled) return;
      setEnabled(flagOn);
      setScenariosEnabled(scenariosFlagOn);
      if (!flagOn) return;

      try {
        const supabase = getSupabaseBrowserClient();

        const [observationsRes, manualRes] = await Promise.all([
          supabase
            .from("commodity_price_observations")
            .select("commodity, source, price_type, value, unit, currency, period_date, region, raw_item_label")
            .order("period_date", { ascending: false })
            .limit(RECENT_OBSERVATIONS_LIMIT),
          supabase
            .from("manual_data_entries")
            .select("entry_date, payload")
            .eq("domain", "commodity_prices")
            .eq("status", "published")
            .order("entry_date", { ascending: false })
            .limit(RECENT_MANUAL_ENTRIES_LIMIT),
        ]);

        if (cancelled) return;
        if (observationsRes.error || manualRes.error) {
          setError("Could not load commodity prices.");
          return;
        }

        const automated: NormalizedPriceObservation[] = ((observationsRes.data as ObservationRow[]) ?? [])
          .filter((row) => fewsNetOn || row.source !== "FEWS_NET")
          .map((row) => ({
            commodity: row.commodity,
            source: row.source,
            priceType: row.price_type as NormalizedPriceObservation["priceType"],
            value: row.value,
            unit: row.unit,
            currency: row.currency,
            periodDate: row.period_date,
            region: row.region,
            rawItemLabel: row.raw_item_label,
          }));

        const manual: NormalizedPriceObservation[] = ((manualRes.data as PublishedManualEntry[]) ?? []).map(
          (entry) => normalizeManualCommodityEntry({ entryDate: entry.entry_date, payload: entry.payload })
        );

        setReconciled(reconcileCommodityPrices([...automated, ...manual]));
      } catch {
        if (!cancelled) setError("Could not load commodity prices.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (enabled === null || enabled === false) return null;

  return (
    <div className="rounded-xl border border-brand-grey-green bg-brand-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-brand-teal-dark">Commodity prices</h2>
      <p className="mt-1 text-sm text-brand-muted">
        NBS and World Bank RTFP update automatically; AFEX is entered manually once reviewed.
      </p>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!error && reconciled.length === 0 ? (
        <p className="mt-4 text-sm text-brand-muted">No commodity price data yet.</p>
      ) : (
        <>
          {/* Sub-phase 6 Step 2 pilot — see ProductionConditionsCard.tsx's
              identical placement/reasoning. */}
          {scenariosEnabled && activeGroupKey && activeCommodityLabel && (
            <ScenarioPanel
              commodity={activeCommodityLabel}
              loading={scenarioLoading}
              error={scenarioError}
              scenario={scenarioData}
            />
          )}

          <ul className="mt-4 space-y-3">
            {reconciled.map((group) => (
              <li
                key={groupKey(group)}
                className="border-b border-brand-grey-green/40 pb-2 last:border-none"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium text-brand-ink">
                    {group.commodity}
                    <span className="ml-1.5 text-xs font-normal text-brand-muted">
                      ({group.priceType === "exchange_spot" ? "exchange spot" : group.priceType})
                    </span>
                  </span>
                  {group.average !== null && (
                    <span className="text-sm font-semibold text-brand-teal-dark">
                      avg {group.currency} {group.average.toFixed(2)}/{group.unit.replace("NGN per ", "")}
                    </span>
                  )}
                </div>
                <ul className="mt-1 space-y-0.5">
                  {group.observations.map((obs) => (
                    <li key={obs.source} className="flex justify-between text-xs text-brand-ink-soft">
                      <span>{obs.source}</span>
                      <span>
                        {obs.currency} {obs.value.toFixed(2)}/{obs.unit.replace("NGN per ", "")} · {obs.periodDate}
                      </span>
                    </li>
                  ))}
                </ul>
                {scenariosEnabled && (
                  <button
                    type="button"
                    onClick={() => handleGenerateScenario(group)}
                    disabled={scenarioLoading}
                    className="mt-1.5 flex items-center gap-1 rounded-md border border-brand-teal/30 bg-brand-mint-pale/60 px-2 py-1 text-[10px] font-semibold text-brand-teal-dark transition hover:bg-brand-mint-pale disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <TrendingUp className="h-3 w-3" aria-hidden="true" />
                    Model scenarios
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
