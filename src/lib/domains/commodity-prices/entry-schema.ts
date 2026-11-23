import { z } from "zod";

/**
 * Payload shape for one commodity_prices manual entry — the first domain
 * built on top of the generic manual_data_entries table (see migration
 * 0004_production_conditions_and_manual_entries.sql).
 *
 * commodity_prices was briefly a manual-entry-only domain after an initial
 * access-method review, then partially automated in migration 0005: NBS
 * and World Bank RTFP now write to commodity_price_observations via their
 * own weekly crons (src/lib/domains/commodity-prices/nbs-backfill.ts,
 * worldbank-rtfp-backfill.ts), because the user clarified that automating
 * all three (plus FAOSTAT) with weekly ingestion was always the intended
 * Phase-1 plan. AFEX stays manual — it still has no official API,
 * developer portal, or documented data feed of any kind, so a staffer
 * keys in a figure they read off AFEX's own public price page instead.
 *
 * `source` stays the full enum (NBS_HFP, WORLD_BANK_RTFP, AFEX, OTHER) —
 * not narrowed to AFEX alone — so a staffer can still manually corroborate
 * or backfill a gap in the automated NBS/World Bank RTFP figures if one
 * comes up, with sourceNote (a sibling field on the manual_data_entries
 * row itself, not part of this payload) capturing exactly where/how it
 * was obtained. See src/lib/domains/commodity-prices/price-types.ts for
 * how a manual entry's `source` decides whether it's reconciled alongside
 * the automated retail-price figures or shown separately as an exchange
 * spot price.
 */
export const COMMODITY_PRICE_SOURCES = ["NBS_HFP", "WORLD_BANK_RTFP", "AFEX", "OTHER"] as const;
export type CommodityPriceSource = (typeof COMMODITY_PRICE_SOURCES)[number];

export const CommodityPriceEntryPayloadSchema = z.object({
  commodity: z.string().trim().min(1, "Commodity is required").max(100),
  // Defaults to a national-average reading — matches
  // production_conditions.region's default of 'National' — but this
  // domain is explicitly "national AND market-level," so a specific
  // market name is equally valid input.
  market: z.string().trim().min(1).max(100).default("National average"),
  price: z.number().positive("Price must be a positive number"),
  // Free text, not an enum — "kg", "50kg bag", "litre", "basket" all vary
  // by commodity and by which source's report it came from.
  unit: z.string().trim().min(1, "Unit is required").max(50),
  currency: z.string().trim().min(1).max(10).default("NGN"),
  source: z.enum(COMMODITY_PRICE_SOURCES),
});

export type CommodityPriceEntryPayload = z.infer<typeof CommodityPriceEntryPayloadSchema>;
