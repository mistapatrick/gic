"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isFeatureEnabled } from "@/lib/feature-flags";

interface ProductionRow {
  commodity: string;
  metric: string;
  value: number;
  unit: string;
  year: number;
  region: string;
}

/**
 * Public dashboard card for the production_conditions domain (FAOSTAT —
 * see src/lib/domains/production-conditions/). Reads directly via the
 * anon browser client against the public "Public read production
 * conditions" RLS policy — no server component/API route needed, same
 * pattern the rest of the public dashboard already uses for weather.
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
          .select("commodity, metric, value, unit, year, region")
          .eq("metric", "production_quantity")
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
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (enabled === null || enabled === false) return null;

  // Keep only each commodity's most recent year.
  const latestByCommodity = new Map<string, ProductionRow>();
  for (const row of rows) {
    if (!latestByCommodity.has(row.commodity)) latestByCommodity.set(row.commodity, row);
  }
  const latestRows = Array.from(latestByCommodity.values()).sort((a, b) => b.value - a.value);

  return (
    <div className="rounded-xl border border-brand-grey-green bg-brand-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-brand-teal-dark">Production conditions</h2>
      <p className="mt-1 text-sm text-brand-muted">
        Most recent annual production quantity per tracked commodity, nationally (source: FAOSTAT).
      </p>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!error && latestRows.length === 0 ? (
        <p className="mt-4 text-sm text-brand-muted">No production data ingested yet.</p>
      ) : (
        <ul className="mt-4 space-y-1.5">
          {latestRows.map((row) => (
            <li
              key={row.commodity}
              className="flex items-center justify-between border-b border-brand-grey-green/40 py-1.5 text-sm last:border-none"
            >
              <span className="text-brand-ink">{row.commodity}</span>
              <span className="text-brand-ink-soft">
                {row.value.toLocaleString()} {row.unit} ({row.year})
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
