/**
 * Domain-specific "when does this scenario resolve" knowledge for Sub-phase
 * 6 Step 2 (see claude/gic-phase-1-build-plan.md). Deliberately kept out of
 * scenario-logic.ts, which is domain-agnostic by design (see that file's own
 * header comment) — resolution cadence is exactly the kind of domain
 * knowledge that module says it has no opinion on.
 *
 * Each function is pure (takes `now` as a parameter rather than reading the
 * real clock) so it's directly testable, matching this codebase's existing
 * discipline for date logic (see getPreviousLagosDate in
 * src/lib/domains/weather/ingest-logic.ts).
 */

export interface ResolutionHorizon {
  /** Plain-English description surfaced to the model (see
   * ScenarioGenerationInput.resolutionHorizonDescription) so its framing of
   * "what resolves this and roughly when" is realistic. */
  description: string;
  /** The scenario_predictions.target_resolution_date column value
   * (YYYY-MM-DD) the caller derives from the description above — this
   * module's one source of truth for both, so the two can never drift out
   * of sync with each other. */
  targetResolutionDate: string;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * production_conditions (FAOSTAT) publishes annually, with the current
 * year's preliminary figures typically appearing well into the following
 * year — so "the next annual release" from any given generation date is
 * reasonably modeled as the end of next year, not the end of this one
 * (which may already be imminent or past by the time a scenario is
 * generated late in the year). This is a stated assumption, not a
 * confirmed FAOSTAT publication-calendar date — same honesty standard this
 * codebase applies to the FAOSTAT area-code and NBS/World-Bank-RTFP catalog
 * assumptions elsewhere.
 */
export function getProductionConditionsResolutionHorizon(now: Date): ResolutionHorizon {
  const targetYear = now.getUTCFullYear() + 1;
  return {
    description: "the next FAOSTAT annual release",
    targetResolutionDate: `${targetYear}-12-31`,
  };
}

/**
 * commodity_prices' automated sources (NBS, World Bank RTFP) each publish
 * on a roughly monthly/weekly-estimate cadence — 21 days gives a
 * comfortably-reachable near-term resolution window without promising a
 * precision in cadence this product doesn't actually track per source.
 */
const COMMODITY_PRICES_RESOLUTION_WINDOW_DAYS = 21;

export function getCommodityPricesResolutionHorizon(now: Date): ResolutionHorizon {
  const target = new Date(now.getTime());
  target.setUTCDate(target.getUTCDate() + COMMODITY_PRICES_RESOLUTION_WINDOW_DAYS);
  return {
    description: "the next NBS/World Bank RTFP weekly price print, expected within 2-3 weeks",
    targetResolutionDate: toDateOnly(target),
  };
}
