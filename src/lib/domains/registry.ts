/**
 * The fixed list of data domains a data_entry account can be scoped to.
 *
 * This is intentionally a hand-maintained allow-list, not whatever happens
 * to exist in the feature_flags table at the time — the account-creation
 * API validates every requested domain_scope value against this list
 * (see src/app/api/admin/accounts/route.ts), so a typo or an attempt to
 * grant scope over a domain that doesn't exist yet fails loudly instead of
 * silently creating an account with a useless or dangling scope.
 *
 * "weather" and "production_conditions" are deliberately absent: both are
 * machine-ingested only (src/lib/domains/weather/,
 * src/lib/domains/production-conditions/) — nobody is ever manually scoped
 * to either.
 *
 * Keep this in sync with the keys seeded into feature_flags in
 * supabase/migrations/0002_auth_roles_audit.sql and
 * 0004_production_conditions_and_manual_entries.sql. When a later
 * sub-phase adds a real domain (e.g. input pricing), add its key here AND
 * flip its feature_flags row — a domain only goes live when both are true.
 *
 * "commodity_prices" (added in Sub-phase 2) is the first domain to use the
 * generic manual_data_entries table (see migration 0004) rather than a
 * domain-specific table of its own — every value here is, by definition, a
 * manual-entry domain name, not necessarily a machine-ingestion one.
 */
export const DATA_ENTRY_DOMAINS = [
  "input_pricing",
  "crop_pest_tracking",
  "livestock_outbreak_tracking",
  "commodity_prices",
] as const;

export type DataEntryDomain = (typeof DATA_ENTRY_DOMAINS)[number];

export function isKnownDomain(value: string): value is DataEntryDomain {
  return (DATA_ENTRY_DOMAINS as readonly string[]).includes(value);
}
