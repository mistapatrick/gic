"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPin, CloudRain, Sprout, Tags } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { GEO_ZONES, type GeoZone } from "@/lib/types";
import { getClusterCommodities } from "@/lib/domains/geo-intelligence/cluster-commodities";
import {
  reconcileCommodityPrices,
  normalizeManualCommodityEntry,
  type NormalizedPriceObservation,
  type ReconciledCommodityPrice,
} from "@/lib/domains/commodity-prices/price-types";
import type { CommodityPriceEntryPayload } from "@/lib/domains/commodity-prices/entry-schema";

interface WeatherClusterRow {
  id: number;
  slug: string;
  state_label: string;
  cluster_name: string;
  geo_zone: GeoZone;
}

interface ProductionRow {
  commodity: string;
  value: number;
  unit: string;
  year: number;
}

interface PublishedProductionEntry {
  payload: { commodity: string; metric: string; value: number; unit: string; year: number; region: string };
}

interface PriceObservationRow {
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

interface PublishedPriceEntry {
  entry_date: string;
  payload: CommodityPriceEntryPayload;
}

// Roughly a 3-month lookback — the same order of magnitude as the weather
// export domain's own MAX_HOURLY_RANGE_DAYS=92 cap, kept a little short of
// it so this never risks pulling more than one page of hourly rows.
const RAINFALL_WINDOW_DAYS = 90;

interface RainfallSummary {
  totalMm: number;
  rainyDays: number;
  wettestDate: string | null;
  wettestMm: number;
  monthly: Array<{ month: string; mm: number }>;
}

function summarizeRainfall(rows: Array<{ obs_date: string; precip_mm: number }>): RainfallSummary {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    byDate.set(row.obs_date, (byDate.get(row.obs_date) ?? 0) + row.precip_mm);
  }

  let totalMm = 0;
  let rainyDays = 0;
  let wettestDate: string | null = null;
  let wettestMm = 0;
  const byMonth = new Map<string, number>();

  for (const [date, mm] of byDate.entries()) {
    totalMm += mm;
    if (mm > 0.1) rainyDays += 1;
    if (mm > wettestMm) {
      wettestMm = mm;
      wettestDate = date;
    }
    const month = date.slice(0, 7); // YYYY-MM
    byMonth.set(month, (byMonth.get(month) ?? 0) + mm);
  }

  const monthly = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, mm]) => ({ month, mm: Math.round(mm * 10) / 10 }));

  return {
    totalMm: Math.round(totalMm * 10) / 10,
    rainyDays,
    wettestDate,
    wettestMm: Math.round(wettestMm * 10) / 10,
    monthly,
  };
}

/**
 * Public dashboard card for the geo-intelligence domain, approved by the
 * user on 2026-11-27: "pick a cluster and see its rainfall history,
 * production concentration, and market access in one place" — scoped to the
 * 29 weather clusters (24 original + 5 added in migration 0010: Kaduna,
 * Sokoto, Kogi, Kwara, Bayelsa).
 *
 * Rainfall history is the one genuinely cluster-specific panel here,
 * aggregated client-side from observed_hourly.precip_mm over the last
 * RAINFALL_WINDOW_DAYS days. Production and market-access figures are NOT
 * cluster-specific — production_conditions (FAOSTAT) and commodity_prices
 * (NBS/World Bank RTFP/AFEX/FEWS NET) are both national-level sources with
 * no sub-national breakdown — so, per the user's explicit decision, those
 * two panels show the real national figures for the commodities associated
 * with the selected cluster (see cluster-commodities.ts), always labeled
 * "national-level, not cluster-specific" rather than hidden or invented.
 *
 * Hidden entirely while feature_flags.geo_intelligence is false, same
 * cautious-by-default pattern as every other domain card.
 */
export function GeoIntelligenceCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [clusters, setClusters] = useState<WeatherClusterRow[]>([]);
  const [clustersError, setClustersError] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const [rainfallRows, setRainfallRows] = useState<Array<{ obs_date: string; precip_mm: number }> | null>(null);
  const [rainfallLoading, setRainfallLoading] = useState(false);
  const [rainfallError, setRainfallError] = useState<string | null>(null);

  const [productionRows, setProductionRows] = useState<ProductionRow[]>([]);
  const [reconciledPrices, setReconciledPrices] = useState<ReconciledCommodityPrice[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const flagOn = await isFeatureEnabled("geo_intelligence");
      if (cancelled) return;
      setEnabled(flagOn);
      if (!flagOn) return;

      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase
          .from("weather_clusters")
          .select("id, slug, state_label, cluster_name, geo_zone")
          .order("geo_zone", { ascending: true })
          .order("cluster_name", { ascending: true });
        if (cancelled) return;
        if (error) {
          setClustersError("Could not load the list of clusters.");
          return;
        }
        setClusters((data as WeatherClusterRow[]) ?? []);
      } catch {
        if (!cancelled) setClustersError("Could not load the list of clusters.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCluster = useMemo(
    () => clusters.find((c) => c.slug === selectedSlug) ?? null,
    [clusters, selectedSlug]
  );

  const clustersByZone = useMemo(() => {
    const map = new Map<GeoZone, WeatherClusterRow[]>();
    for (const zone of GEO_ZONES) map.set(zone, []);
    for (const cluster of clusters) {
      const list = map.get(cluster.geo_zone) ?? [];
      list.push(cluster);
      map.set(cluster.geo_zone, list);
    }
    return map;
  }, [clusters]);

  // Rainfall history: genuinely cluster-specific, from this cluster's own
  // observed_hourly rows. Stale data from a previously selected cluster is
  // harmless here even without an explicit reset — the render below only
  // shows this section at all while selectedCluster is truthy, and it's
  // replaced the moment the new fetch resolves.
  useEffect(() => {
    let cancelled = false;

    async function loadRainfall() {
      // Yield one microtask before touching state, so nothing here runs
      // synchronously within the effect's own call stack.
      await Promise.resolve();
      if (cancelled || !selectedCluster) return;

      setRainfallLoading(true);
      setRainfallError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const since = new Date();
        since.setDate(since.getDate() - RAINFALL_WINDOW_DAYS);
        const sinceStr = since.toISOString().slice(0, 10);

        const { data, error } = await supabase
          .from("observed_hourly")
          .select("obs_date, precip_mm")
          .eq("cluster_id", selectedCluster!.id)
          .gte("obs_date", sinceStr)
          .order("obs_date", { ascending: true });

        if (cancelled) return;
        if (error) {
          setRainfallError("Could not load rainfall history for this cluster.");
          return;
        }
        setRainfallRows((data as Array<{ obs_date: string; precip_mm: number }>) ?? []);
      } catch {
        if (!cancelled) setRainfallError("Could not load rainfall history for this cluster.");
      } finally {
        if (!cancelled) setRainfallLoading(false);
      }
    }

    loadRainfall();
    return () => {
      cancelled = true;
    };
  }, [selectedCluster]);

  // Production concentration + market access: national figures for the
  // commodities associated with this cluster (not cluster-specific). Same
  // "no explicit reset needed" reasoning as the rainfall effect above — the
  // render below only shows this section while selectedCluster is truthy.
  useEffect(() => {
    let cancelled = false;

    async function loadContext() {
      // Yield one microtask before touching state, so nothing here runs
      // synchronously within the effect's own call stack.
      await Promise.resolve();
      if (cancelled || !selectedCluster) return;

      const commodities = getClusterCommodities(selectedCluster.slug);
      if (commodities.length === 0) {
        setProductionRows([]);
        setReconciledPrices([]);
        return;
      }

      setContextLoading(true);
      setContextError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const [productionRes, manualProductionRes, priceObsRes, manualPriceRes] = await Promise.all([
          supabase
            .from("production_conditions")
            .select("commodity, value, unit, year")
            .eq("metric", "production_quantity")
            .eq("region", "National")
            .in("commodity", commodities)
            .order("year", { ascending: false }),
          supabase
            .from("manual_data_entries")
            .select("payload")
            .eq("domain", "production_conditions")
            .eq("status", "published")
            .limit(200),
          supabase
            .from("commodity_price_observations")
            .select("commodity, source, price_type, value, unit, currency, period_date, region, raw_item_label")
            .in("commodity", commodities)
            .order("period_date", { ascending: false })
            .limit(500),
          supabase
            .from("manual_data_entries")
            .select("entry_date, payload")
            .eq("domain", "commodity_prices")
            .eq("status", "published")
            .order("entry_date", { ascending: false })
            .limit(200),
        ]);

        if (cancelled) return;
        if (
          productionRes.error ||
          manualProductionRes.error ||
          priceObsRes.error ||
          manualPriceRes.error
        ) {
          setContextError("Could not load national production/price context for this cluster's crops.");
          return;
        }

        const automatedProduction = (productionRes.data as ProductionRow[]) ?? [];
        const manualProduction: ProductionRow[] = (
          (manualProductionRes.data as PublishedProductionEntry[]) ?? []
        )
          .filter(
            (entry) =>
              entry.payload.region === "National" &&
              entry.payload.metric === "production_quantity" &&
              commodities.includes(entry.payload.commodity)
          )
          .map((entry) => ({
            commodity: entry.payload.commodity,
            value: entry.payload.value,
            unit: entry.payload.unit,
            year: entry.payload.year,
          }));

        const latestByCommodity = new Map<string, ProductionRow>();
        for (const row of [...automatedProduction, ...manualProduction].sort((a, b) => b.year - a.year)) {
          if (!latestByCommodity.has(row.commodity)) latestByCommodity.set(row.commodity, row);
        }
        setProductionRows(Array.from(latestByCommodity.values()));

        const automatedPrices: NormalizedPriceObservation[] = ((priceObsRes.data as PriceObservationRow[]) ?? []).map(
          (row) => ({
            commodity: row.commodity,
            source: row.source,
            priceType: row.price_type as NormalizedPriceObservation["priceType"],
            value: row.value,
            unit: row.unit,
            currency: row.currency,
            periodDate: row.period_date,
            region: row.region,
            rawItemLabel: row.raw_item_label,
          })
        );
        const manualPrices: NormalizedPriceObservation[] = ((manualPriceRes.data as PublishedPriceEntry[]) ?? [])
          .filter((entry) => commodities.includes(entry.payload.commodity))
          .map((entry) => normalizeManualCommodityEntry({ entryDate: entry.entry_date, payload: entry.payload }));
        setReconciledPrices(reconcileCommodityPrices([...automatedPrices, ...manualPrices]));
      } catch {
        if (!cancelled) setContextError("Could not load national production/price context for this cluster's crops.");
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    }

    loadContext();
    return () => {
      cancelled = true;
    };
  }, [selectedCluster]);

  if (enabled === null || enabled === false) return null;

  const rainfall = rainfallRows ? summarizeRainfall(rainfallRows) : null;
  const maxMonthlyMm = rainfall ? Math.max(1, ...rainfall.monthly.map((m) => m.mm)) : 1;
  const commodities = selectedCluster ? getClusterCommodities(selectedCluster.slug) : [];

  return (
    <div className="rounded-xl border border-brand-grey-green bg-brand-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <MapPin className="h-5 w-5 text-brand-teal" aria-hidden="true" />
        <h2 className="text-base font-semibold text-brand-teal-dark">Geo intelligence</h2>
      </div>
      <p className="mt-1 text-sm text-brand-muted">
        Pick one of the 29 agricultural clusters to see its own rainfall history, alongside national
        production and market context for the crops it&apos;s known for.
      </p>

      {clustersError && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{clustersError}</p>
      )}

      {!clustersError && (
        <div className="mt-4">
          <label htmlFor="geo-intelligence-cluster" className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
            Cluster
          </label>
          <select
            id="geo-intelligence-cluster"
            className="mt-1 w-full rounded-lg border border-brand-grey-green bg-brand-white px-3 py-2 text-sm text-brand-ink"
            value={selectedSlug ?? ""}
            onChange={(e) => setSelectedSlug(e.target.value || null)}
          >
            <option value="">Select a cluster…</option>
            {GEO_ZONES.map((zone) => {
              const list = clustersByZone.get(zone) ?? [];
              if (list.length === 0) return null;
              return (
                <optgroup key={zone} label={zone}>
                  {list.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.cluster_name} — {c.state_label}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>
      )}

      {!selectedCluster && !clustersError && (
        <p className="mt-6 text-sm text-brand-muted">Select a cluster above to see its intelligence panel.</p>
      )}

      {selectedCluster && (
        <div className="mt-5 space-y-5">
          {/* Rainfall history — genuinely cluster-specific */}
          <section className="rounded-xl border border-brand-grey-green bg-brand-mint-pale/40 p-4">
            <div className="flex items-center gap-2">
              <CloudRain className="h-4 w-4 text-brand-teal" aria-hidden="true" />
              <span className="text-xs font-bold uppercase tracking-wider text-brand-teal">
                Rainfall history — {selectedCluster.cluster_name} (last {RAINFALL_WINDOW_DAYS} days)
              </span>
            </div>

            {rainfallLoading && <p className="mt-2 text-sm text-brand-muted">Loading…</p>}
            {rainfallError && <p className="mt-2 text-sm text-red-700">{rainfallError}</p>}

            {!rainfallLoading && !rainfallError && rainfall && rainfall.monthly.length === 0 && (
              <p className="mt-2 text-sm text-brand-muted">
                No rainfall history yet for this cluster. If it was only just added, its first admin
                backfill run may not have been done yet — nightly ingestion alone won&apos;t have built up
                {" "}
                {RAINFALL_WINDOW_DAYS} days of history.
              </p>
            )}

            {!rainfallLoading && !rainfallError && rainfall && rainfall.monthly.length > 0 && (
              <>
                <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-lg font-bold text-brand-ink">{rainfall.totalMm.toLocaleString()} mm</div>
                    <div className="text-[11px] text-brand-ink-soft">Total rainfall</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-brand-ink">{rainfall.rainyDays}</div>
                    <div className="text-[11px] text-brand-ink-soft">Rainy days</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-brand-ink">{rainfall.wettestMm.toLocaleString()} mm</div>
                    <div className="text-[11px] text-brand-ink-soft">
                      Wettest day{rainfall.wettestDate ? ` (${rainfall.wettestDate})` : ""}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-end gap-1.5" style={{ height: "64px" }}>
                  {rainfall.monthly.map((m) => (
                    <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t bg-brand-teal"
                        style={{ height: `${Math.max(4, (m.mm / maxMonthlyMm) * 48)}px` }}
                        title={`${m.month}: ${m.mm} mm`}
                      />
                      <span className="text-[9px] text-brand-ink-soft">{m.month.slice(5)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Production concentration + market access — national, not cluster-specific */}
          <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <div className="flex items-center gap-2">
              <Sprout className="h-4 w-4 text-amber-700" aria-hidden="true" />
              <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
                Production &amp; market context — national-level, not cluster-specific
              </span>
            </div>
            <p className="mt-1.5 text-xs text-brand-ink-soft">
              {selectedCluster.cluster_name} is known for{" "}
              {commodities.length > 0 ? commodities.join(", ") : "no commodities mapped yet"}. FAOSTAT and
              Nigeria&apos;s price sources (NBS, World Bank RTFP, AFEX, FEWS NET) don&apos;t publish figures
              below the national level, so the numbers below are Nigeria-wide — shown here as relevant
              context for this cluster&apos;s crops, not as a measurement of this cluster itself.
            </p>

            {contextLoading && <p className="mt-3 text-sm text-brand-muted">Loading…</p>}
            {contextError && <p className="mt-3 text-sm text-red-700">{contextError}</p>}

            {!contextLoading && !contextError && commodities.length === 0 && (
              <p className="mt-3 text-sm text-brand-muted">
                No associated commodities are mapped for this cluster yet.
              </p>
            )}

            {!contextLoading && !contextError && commodities.length > 0 && (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-brand-muted">
                    National production
                  </h4>
                  {productionRows.length === 0 ? (
                    <p className="mt-1 text-sm text-brand-muted">No production figures for these commodities yet.</p>
                  ) : (
                    <ul className="mt-1.5 space-y-1">
                      {productionRows.map((row) => (
                        <li key={row.commodity} className="flex justify-between text-xs text-brand-ink">
                          <span>{row.commodity}</span>
                          <span className="font-medium">
                            {row.value.toLocaleString()} {row.unit} ({row.year})
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h4 className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-brand-muted">
                    <Tags className="h-3 w-3" aria-hidden="true" /> National market prices
                  </h4>
                  {reconciledPrices.length === 0 ? (
                    <p className="mt-1 text-sm text-brand-muted">No price data for these commodities yet.</p>
                  ) : (
                    <ul className="mt-1.5 space-y-1">
                      {reconciledPrices.map((p) => (
                        <li
                          key={`${p.commodity}::${p.priceType}::${p.unit}::${p.region}`}
                          className="flex justify-between text-xs text-brand-ink"
                        >
                          <span>
                            {p.commodity}{" "}
                            <span className="text-brand-ink-soft">
                              ({p.priceType === "exchange_spot" ? "exchange spot" : p.priceType})
                            </span>
                          </span>
                          <span className="font-medium">
                            {p.currency} {(p.average ?? p.observations[0]?.value)?.toFixed(2)}/
                            {p.unit.replace("NGN per ", "")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
