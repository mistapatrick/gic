"use client";

import { Lightbulb } from "lucide-react";
import type { ScenarioBranch, ScenarioSet } from "@/lib/scenarios/scenario-logic";

/**
 * Shared rendering for one generated scenario set (Sub-phase 6 Step 2) —
 * used by both ProductionConditionsCard.tsx and CommodityPricesCard.tsx so
 * the three-branch (do_nothing / act_a / act_b) layout, confidence badge,
 * and force-majeure caveat styling stay identical across both pilot
 * domains rather than drifting apart as two near-duplicate copies.
 *
 * Purely presentational — owns no fetch logic or state; the calling card
 * manages its own `loading`/`scenario`/`error` state per commodity and
 * passes the current one down here.
 */

const BRANCH_LABEL: Record<ScenarioBranch["branch"], string> = {
  do_nothing: "If nothing changes",
  act_a: "Option A",
  act_b: "Option B",
};

const CONFIDENCE_STYLE: Record<ScenarioBranch["confidence_label"], string> = {
  low: "bg-amber-50 text-amber-700 border-amber-200",
  moderate: "bg-brand-mint-pale text-brand-teal-dark border-brand-teal/30",
  high: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export interface ScenarioPanelProps {
  commodity: string;
  loading: boolean;
  error: string | null;
  scenario: ScenarioSet | null;
}

export function ScenarioPanel({ commodity, loading, error, scenario }: ScenarioPanelProps) {
  return (
    <section className="mt-4 rounded-xl border border-brand-grey-green bg-brand-mint-pale/40 p-4">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-brand-teal" aria-hidden="true" />
        <span className="text-xs font-bold uppercase tracking-wider text-brand-teal">
          Business scenarios — {commodity}
        </span>
      </div>

      {loading && (
        <p className="mt-2 text-sm text-brand-ink-soft">Modeling business scenarios…</p>
      )}

      {!loading && error && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {!loading && !error && scenario && (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
          {scenario.branches.map((branch) => (
            <div
              key={branch.branch}
              className="rounded-lg border border-brand-grey-green bg-brand-white p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-brand-ink">
                  {BRANCH_LABEL[branch.branch]}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${CONFIDENCE_STYLE[branch.confidence_label]}`}
                >
                  {branch.confidence_label} confidence
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-brand-ink-soft">
                {branch.narrative}
              </p>
              {branch.predicted_range_low !== null && branch.predicted_range_high !== null && (
                <p className="mt-1.5 text-xs font-medium text-brand-teal-dark">
                  {branch.predicted_range_low.toLocaleString()}–
                  {branch.predicted_range_high.toLocaleString()} {branch.unit}
                </p>
              )}
              <p className="mt-1.5 text-[11px] italic text-brand-ink-soft">
                Caveat: {branch.force_majeure_caveat}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
