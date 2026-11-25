"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isFeatureEnabled } from "@/lib/feature-flags";

interface FoodSecurityRow {
  admin1_name: string;
  admin2_name: string;
  admin_level: string;
  ipc_phase: string;
  ipc_type: string;
  population_in_phase: number | null;
  population_fraction_in_phase: number | null;
  reference_period_start: string;
  reference_period_end: string;
}

const PHASE_LABEL: Record<string, string> = {
  "1": "Phase 1 — Minimal",
  "2": "Phase 2 — Stressed",
  "3": "Phase 3 — Crisis",
  "4": "Phase 4 — Emergency",
  "5": "Phase 5 — Famine",
  "3+": "Phase 3+",
  all: "All phases (total)",
};

/**
 * Public dashboard card for food_security (HDX HAPI — IPC/Cadre Harmonisé
 * acute food insecurity classification). Reads directly via the anon
 * browser client against the public "Public read food security
 * observations" RLS policy, same pattern as ProductionConditionsCard.
 * Hidden entirely (renders null) while feature_flags.food_security is
 * false — which it stays until the user verifies a real ingest run and
 * decides this data belongs on the public dashboard.
 */
export function FoodSecurityCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [rows, setRows] = useState<FoodSecurityRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const flagOn = await isFeatureEnabled("food_security");
      if (cancelled) return;
      setEnabled(flagOn);
      if (!flagOn) return;

      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: fetchError } = await supabase
          .from("food_security_observations")
          .select(
            "admin1_name, admin2_name, admin_level, ipc_phase, ipc_type, population_in_phase, population_fraction_in_phase, reference_period_start, reference_period_end"
          )
          .eq("ipc_type", "current")
          .neq("ipc_phase", "all")
          .order("reference_period_start", { ascending: false })
          .limit(500);

        if (cancelled) return;
        if (fetchError) {
          setError("Could not load food security data.");
          return;
        }
        setRows((data as FoodSecurityRow[]) ?? []);
      } catch {
        if (!cancelled) setError("Could not load food security data.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (enabled === null || enabled === false) return null;

  // Keep only the most recent reference period present in the data.
  const latestPeriod = rows.reduce(
    (max, r) => (r.reference_period_start > max ? r.reference_period_start : max),
    rows[0]?.reference_period_start ?? ""
  );
  const latestRows = rows
    .filter((r) => r.reference_period_start === latestPeriod)
    .sort((a, b) => b.ipc_phase.localeCompare(a.ipc_phase));

  return (
    <div className="rounded-xl border border-brand-grey-green bg-brand-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-brand-teal-dark">Food security</h2>
      <p className="mt-1 text-sm text-brand-muted">
        Current acute food insecurity (IPC/Cadre Harmonisé) classification by state (source: HDX HAPI).
      </p>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!error && latestRows.length === 0 ? (
        <p className="mt-4 text-sm text-brand-muted">No food security data ingested yet.</p>
      ) : (
        <ul className="mt-4 space-y-1.5">
          {latestRows.map((row) => (
            <li
              key={`${row.admin1_name}::${row.admin2_name}::${row.ipc_phase}`}
              className="flex items-center justify-between border-b border-brand-grey-green/40 py-1.5 text-sm last:border-none"
            >
              <span className="text-brand-ink">
                {row.admin2_name || row.admin1_name || "Nigeria"}
                {row.admin2_name && row.admin1_name ? (
                  <span className="text-brand-ink-soft"> ({row.admin1_name})</span>
                ) : null}
              </span>
              <span className="text-brand-ink-soft">
                {PHASE_LABEL[row.ipc_phase] ?? `Phase ${row.ipc_phase}`}
                {row.population_in_phase !== null ? ` · ${row.population_in_phase.toLocaleString()} people` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
