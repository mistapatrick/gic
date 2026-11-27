import { z } from "zod";

/**
 * Payload shape for one production_conditions manual entry — added
 * 2026-11-27 alongside widening commodity_prices' manual entry to cover
 * all three price sources (see entry-schema.ts in
 * src/lib/domains/commodity-prices/ for that one). Both changes share the
 * same motivation: the user's own experience running the automated
 * ingestion this engagement — Vercel timeouts, an HTML wall instead of the
 * expected file format, unverifiable area/item codes, a transient HDX
 * block (see the Live-deployment-fixes section of the build-plan doc) —
 * showed enough real friction that a manual backstop was worth building
 * now rather than only ever trusting the crons. The automated FAOSTAT
 * ingestion (weekly cron + the GitHub Actions bulk backfill) keeps running
 * unchanged; this is an additional path into the same history, not a
 * replacement.
 *
 * `metric` reuses the exact same five values production_conditions'
 * database check constraint accepts (migrations 0004 and 0007) — see
 * src/lib/domains/production-conditions/ingest-logic.ts's own
 * ProductionMetric type, which this schema deliberately does not import
 * from (that file is the automated FAOSTAT-parsing module; duplicating the
 * five literal strings here keeps this schema's only dependency being Zod,
 * matching commodity-prices/entry-schema.ts's own precedent of not
 * importing ingest-logic.ts's parsing internals into a payload schema).
 *
 * Unlike CommodityPriceEntryPayloadSchema, `commodity` is NOT constrained
 * to TRACKED_COMMODITIES — a staffer correcting or backfilling a gap may
 * need to enter a commodity this list doesn't cover yet, and the
 * dashboard card's existing getCropCategory()/getCropEmoji() helpers both
 * already fall back gracefully for an unrecognized commodity name rather
 * than erroring.
 */
export const PRODUCTION_CONDITION_METRICS = [
  "production_quantity",
  "yield",
  "area_harvested",
  "stocks",
  "producing_animals_slaughtered",
] as const;
export type ProductionConditionMetric = (typeof PRODUCTION_CONDITION_METRICS)[number];

export const ProductionConditionEntryPayloadSchema = z.object({
  commodity: z.string().trim().min(1, "Commodity is required").max(100),
  metric: z.enum(PRODUCTION_CONDITION_METRICS),
  value: z.number().nonnegative("Value cannot be negative"),
  unit: z.string().trim().min(1, "Unit is required").max(50),
  // Matches production_conditions.year's own check constraint (1960-2100).
  year: z.number().int().min(1960).max(2100),
  region: z.string().trim().min(1).max(100).default("National"),
});

export type ProductionConditionEntryPayload = z.infer<typeof ProductionConditionEntryPayloadSchema>;
