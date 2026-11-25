import { z } from "zod";

/**
 * Domain-agnostic scenario generation — Step 1 "basic components" of GIC's
 * Modelling stage (stage 3 of the Data -> Insight -> Modelling -> Adaptation
 * -> Intelligence loop; see claude/gic-phase-1-synopsis.md's "Core framing"
 * section and Sub-phase 6 in claude/gic-phase-1-build-plan.md).
 *
 * Mirrors the shape of src/lib/domains/production-conditions/brief-logic.ts
 * (a Zod schema for structured AI output, a pure prompt-builder, no I/O of
 * its own) but is deliberately NOT under src/lib/domains/<domain>/, because
 * nothing here is specific to one domain — any domain that can supply a
 * compact telemetry string and the fields in ScenarioGenerationInput can use
 * it, the same way src/lib/ingestion/backfill-framework.ts is one generic
 * module every domain's backfill adapter plugs into rather than each domain
 * growing its own.
 *
 * This module builds the prompt and validates the result; it does not call
 * the AI SDK itself (see generate-scenario.ts for that) and does not write
 * to scenario_predictions (no domain is wired to persist a generated
 * scenario yet — that is Step 2, not started as of this file).
 */

/** The three outcome branches every generated scenario set always has — see
 * migration 0008's comment on scenario_predictions.branch for why exactly
 * these three and not a looser "3-4 outcomes" count. */
export const SCENARIO_BRANCHES = ["do_nothing", "act_a", "act_b"] as const;
export type ScenarioBranchId = (typeof SCENARIO_BRANCHES)[number];

/** Nigeria's three agricultural sub-sectors GIC covers (see the synopsis's
 * "What it is" section) — every commodity in TRACKED_COMMODITIES-style
 * registries across domains belongs to exactly one. */
export const AGRICULTURE_TYPES = ["crop", "livestock", "fishery"] as const;
export type AgricultureType = (typeof AGRICULTURE_TYPES)[number];

export const CONFIDENCE_LABELS = ["low", "moderate", "high"] as const;
export type ConfidenceLabel = (typeof CONFIDENCE_LABELS)[number];

const ScenarioBranchSchema = z.object({
  branch: z
    .enum(SCENARIO_BRANCHES)
    .describe(
      "Which of the three fixed outcome branches this is: 'do_nothing' (the baseline if no " +
        "action is taken), 'act_a' (one concrete business action), or 'act_b' (a different, " +
        "genuinely distinct business action — not a minor variation of act_a)."
    ),
  narrative: z
    .string()
    .describe(
      "2-3 sentences: what this branch means in business terms for an investor or business " +
        "owner, grounded only in the data given below — never invent a figure or trend the " +
        "data doesn't support."
    ),
  predicted_range_low: z
    .number()
    .nullable()
    .describe("Low end of the predicted numeric outcome range, in the same unit as the input data. Null if this branch has no sensible numeric range (e.g. a qualitative outcome)."),
  predicted_range_high: z
    .number()
    .nullable()
    .describe("High end of the predicted numeric outcome range. Null under the same condition as predicted_range_low."),
  unit: z
    .string()
    .nullable()
    .describe("The unit predicted_range_low/high are expressed in (matching the input data's own unit). Null if both range fields are null."),
  confidence_label: z
    .enum(CONFIDENCE_LABELS)
    .describe("How confident this branch's prediction is, given how much historical data supports it and how far out target_resolution_date is."),
  force_majeure_caveat: z
    .string()
    .describe(
      "One sentence naming the kind of unforeseeable event (e.g. flooding, a disease outbreak, " +
        "a policy shock, a currency shock) that would invalidate this branch's prediction " +
        "regardless of how sound the reasoning was — framed as scenario modeling, never a " +
        "guarantee."
    ),
});

export const ScenarioSetSchema = z.object({
  branches: z
    .array(ScenarioBranchSchema)
    .length(3)
    .describe("Exactly three branches, one each for do_nothing, act_a, and act_b, in that order."),
});

export type ScenarioSet = z.infer<typeof ScenarioSetSchema>;
export type ScenarioBranch = z.infer<typeof ScenarioBranchSchema>;

export interface ScenarioGenerationInput {
  /** The domain's own table name (e.g. "production_conditions",
   * "commodity_price_observations") — stored as-is into
   * scenario_predictions.signal_source_table by the caller, so this module
   * never needs its own domain registry. */
  domain: string;
  commodity: string;
  agricultureType: AgricultureType;
  region: string;
  /** Caller-formatted, domain-specific recent-data text — e.g. the output of
   * production-conditions/brief-logic.ts's buildCompactProductionTelemetry()
   * or an equivalent for commodity prices. This module has no opinion on how
   * a domain formats its own telemetry. */
  compactTelemetry: string;
  /** Plain-English description of what this scenario resolves against and
   * roughly when — e.g. "the next FAOSTAT annual release" or "the next
   * NBS/World Bank RTFP weekly price print, expected within 2-3 weeks" —
   * surfaced to the model so its target_resolution_date framing is
   * realistic, and returned to the caller unchanged so it can derive the
   * actual target_resolution_date column value (this module does not
   * compute dates itself).
   */
  resolutionHorizonDescription: string;
}

export function buildScenarioPrompt(input: ScenarioGenerationInput): string {
  const readableDomain = input.domain.replace(/_/g, " ");
  return (
    "You are a business and investment analyst for Growthly Intelligence Centre, a " +
    "Nigeria-focused agricultural intelligence product for investors and business owners — " +
    "not researchers. Below is the most recent " +
    `${readableDomain} data for ${input.commodity} (${input.agricultureType}) in ` +
    `${input.region}, Nigeria:\n\n` +
    `${input.compactTelemetry}\n\n` +
    "Generate exactly three business-outcome scenario branches — do_nothing, act_a, and act_b " +
    "— each framed as what it would mean for someone deciding whether and how to act on this " +
    "commodity. Each branch needs its own predicted range (or null if not sensible), confidence " +
    "label, and force-majeure caveat.\n\n" +
    `This scenario resolves against ${input.resolutionHorizonDescription}. Never invent a ` +
    "figure, year, or trend the data above doesn't support — ground every branch in what's " +
    "actually given."
  );
}
