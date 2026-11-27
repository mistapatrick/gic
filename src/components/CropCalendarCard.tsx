"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Sprout, CloudRain } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { GEO_ZONES, type GeoZone } from "@/lib/types";
import { CROP_CALENDAR } from "@/lib/domains/crop-calendar/calendar-data";

// A 30-day lookback for "current conditions" — short enough to reflect
// what's happening right now in the field, rather than smearing it across
// a whole season.
const RECENT_RAINFALL_WINDOW_DAYS = 30;

interface RecentConditions {
  totalMmAcrossZone: number;
  clusterCount: number;
  avgMmPerCluster: number;
}

/**
 * Public dashboard card for the crop_calendar domain, approved by the user
 * on 2026-11-27: "a proper agricultural calendar tying weather observations
 * to planting/harvest seasons by crop — using the weather domain's existing
 * telemetry as its data source."
 *
 * The calendar itself (CROP_CALENDAR, calendar-data.ts) is a static,
 * general-agronomic reference per geo-zone — it does not come from live
 * data and doesn't claim to. What IS live is the "current conditions"
 * panel below it: the zone's own recently observed rainfall (last
 * RECENT_RAINFALL_WINDOW_DAYS days), averaged across however many of that
 * zone's weather clusters have data. This is deliberately NOT framed as
 * "on track" / "early" / "delayed" against a historical normal — this
 * product's own weather history only goes back to whenever each cluster
 * was backfilled, not a multi-decade climatological baseline, so there is
 * nothing honest to compare against yet. It is shown as current conditions,
 * full stop, for the farmer or analyst to weigh against the calendar
 * themselves.
 *
 * Hidden entirely while feature_flags.crop_calendar is false, same
 * cautious-by-default pattern as every other domain card.
 */
export function CropCalendarCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [selectedZone, setSelectedZone] = useState<GeoZone>("North-Central");

  const [recent, setRecent] = useState<RecentConditions | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const flagOn = await isFeatureEnabled("crop_calendar");
      if (!cancelled) setEnabled(flagOn);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (enabled !== true) return;
    let cancelled = false;

    async function loadRecentConditions() {
      setRecentLoading(true);
      setRecentError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: clusterRows, error: clusterErr } = await supabase
          .from("weather_clusters")
          .select("id")
          .eq("geo_zone", selectedZone);
        if (cancelled) return;
        if (clusterErr) {
          setRecentError("Could not load this zone's clusters.");
          return;
        }
        const clusterIds = ((clusterRows as Array<{ id: number }>) ?? []).map((c) => c.id);
        if (clusterIds.length === 0) {
          setRecent({ totalMmAcrossZone: 0, clusterCount: 0, avgMmPerCluster: 0 });
          return;
        }

        const since = new Date();
        since.setDate(since.getDate() - RECENT_RAINFALL_WINDOW_DAYS);
        const sinceStr = since.toISOString().slice(0, 10);

        const { data: rainRows, error: rainErr } = await supabase
          .from("observed_hourly")
          .select("cluster_id, precip_mm")
          .in("cluster_id", clusterIds)
          .gte("obs_date", sinceStr);
        if (cancelled) return;
        if (rainErr) {
          setRecentError("Could not load this zone's recent rainfall.");
          return;
        }

        const byCluster = new Map<number, number>();
        for (const row of (rainRows as Array<{ cluster_id: number; precip_mm: number }>) ?? []) {
          byCluster.set(row.cluster_id, (byCluster.get(row.cluster_id) ?? 0) + row.precip_mm);
        }
        const totalMmAcrossZone = Array.from(byCluster.values()).reduce((a, b) => a + b, 0);
        const clusterCount = byCluster.size;
        setRecent({
          totalMmAcrossZone: Math.round(totalMmAcrossZone * 10) / 10,
          clusterCount,
          avgMmPerCluster: clusterCount > 0 ? Math.round((totalMmAcrossZone / clusterCount) * 10) / 10 : 0,
        });
      } catch {
        if (!cancelled) setRecentError("Could not load this zone's recent rainfall.");
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    }

    loadRecentConditions();
    return () => {
      cancelled = true;
    };
  }, [enabled, selectedZone]);

  const entries = useMemo(() => CROP_CALENDAR[selectedZone] ?? [], [selectedZone]);

  if (enabled === null || enabled === false) return null;

  return (
    <div className="rounded-xl border border-brand-grey-green bg-brand-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-brand-teal" aria-hidden="true" />
        <h2 className="text-base font-semibold text-brand-teal-dark">Crop calendar</h2>
      </div>
      <p className="mt-1 text-sm text-brand-muted">
        Typical planting and harvest windows per crop, by geo-zone — general agronomic guidance, not a
        per-cluster forecast. Actual timing shifts year to year with the real onset of the rains.
      </p>

      <div className="mt-4">
        <label htmlFor="crop-calendar-zone" className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
          Geo-zone
        </label>
        <select
          id="crop-calendar-zone"
          className="mt-1 w-full rounded-lg border border-brand-grey-green bg-brand-white px-3 py-2 text-sm text-brand-ink sm:w-auto"
          value={selectedZone}
          onChange={(e) => setSelectedZone(e.target.value as GeoZone)}
        >
          {GEO_ZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </div>

      {/* Current conditions — live, from this zone's own clusters */}
      <section className="mt-4 rounded-xl border border-brand-grey-green bg-brand-mint-pale/40 p-4">
        <div className="flex items-center gap-2">
          <CloudRain className="h-4 w-4 text-brand-teal" aria-hidden="true" />
          <span className="text-xs font-bold uppercase tracking-wider text-brand-teal">
            Current conditions — {selectedZone} (last {RECENT_RAINFALL_WINDOW_DAYS} days)
          </span>
        </div>
        {recentLoading && <p className="mt-2 text-sm text-brand-muted">Loading…</p>}
        {recentError && <p className="mt-2 text-sm text-red-700">{recentError}</p>}
        {!recentLoading && !recentError && recent && recent.clusterCount === 0 && (
          <p className="mt-2 text-sm text-brand-muted">
            No rainfall history yet for this zone&apos;s clusters in this window.
          </p>
        )}
        {!recentLoading && !recentError && recent && recent.clusterCount > 0 && (
          <p className="mt-2 text-sm text-brand-ink">
            Averaging <span className="font-semibold">{recent.avgMmPerCluster.toLocaleString()} mm</span>{" "}
            of rainfall per cluster over the last {RECENT_RAINFALL_WINDOW_DAYS} days, across{" "}
            {recent.clusterCount} cluster{recent.clusterCount === 1 ? "" : "s"} in {selectedZone}. This is
            current conditions only — not a comparison to a historical normal.
          </p>
        )}
      </section>

      {/* Static calendar for the selected zone */}
      <section className="mt-5">
        <div className="flex items-center gap-2">
          <Sprout className="h-4 w-4 text-brand-teal" aria-hidden="true" />
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-brand-muted">
            Planting &amp; harvest windows — {selectedZone}
          </h3>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-brand-grey-green/60 text-[11px] uppercase tracking-wider text-brand-muted">
                <th className="py-1.5 pr-3">Crop</th>
                <th className="py-1.5 pr-3">Typical planting</th>
                <th className="py-1.5 pr-3">Typical harvest</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.commodity} className="border-b border-brand-grey-green/30 align-top last:border-none">
                  <td className="py-2 pr-3 font-medium text-brand-ink">{entry.commodity}</td>
                  <td className="py-2 pr-3 text-brand-ink-soft">{entry.plantingWindow}</td>
                  <td className="py-2 pr-3 text-brand-ink-soft">
                    {entry.harvestWindow}
                    {entry.notes && <div className="mt-0.5 text-[11px] italic text-brand-muted">{entry.notes}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
