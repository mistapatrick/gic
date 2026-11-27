import type { z } from "zod";
import { CommodityPriceEntryPayloadSchema } from "@/lib/domains/commodity-prices/entry-schema";
import { ProductionConditionEntryPayloadSchema } from "@/lib/domains/production-conditions/entry-schema";
import type { DataEntryDomain } from "@/lib/domains/registry";

/**
 * Maps each manual-entry domain to the Zod schema its payload must satisfy.
 * The generic manual_data_entries table (migration 0004) stores `payload`
 * as an untyped jsonb column precisely so new domains can be added here —
 * one new schema + one new map entry — without ever touching the table,
 * the RLS policies, or the submission/review route handlers.
 *
 * production_conditions (added 2026-11-27) is the second domain to reuse
 * this table after commodity_prices, and the first time a previously
 * automated-only domain also got a manual-entry path — see
 * src/lib/domains/registry.ts's comment on why "production_conditions" was
 * added to DATA_ENTRY_DOMAINS.
 *
 * Not every DATA_ENTRY_DOMAINS value necessarily has an entry here yet:
 * input_pricing and crop_pest_tracking are reserved domain names (their
 * feature_flags rows exist, kept dark) but have no manual-entry UI or
 * payload shape built for them until their own sub-phase. Submitting to an
 * unregistered domain is rejected by validateManualEntrySubmission with a
 * clear "not yet built" error rather than silently accepting an
 * unvalidated payload.
 */
export const MANUAL_ENTRY_PAYLOAD_SCHEMAS: Partial<Record<DataEntryDomain, z.ZodTypeAny>> = {
  commodity_prices: CommodityPriceEntryPayloadSchema,
  production_conditions: ProductionConditionEntryPayloadSchema,
};

export function getManualEntryPayloadSchema(domain: string): z.ZodTypeAny | null {
  return MANUAL_ENTRY_PAYLOAD_SCHEMAS[domain as DataEntryDomain] ?? null;
}
