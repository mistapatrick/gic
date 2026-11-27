-- ============================================================================
-- Migration 0011: feature flags for the two new domains approved by the user
-- on 2026-11-27 — geo_intelligence and crop_calendar. Both start disabled
-- (false), same cautious-by-default posture every other domain's flag has
-- used since migration 0004: a flag only gets flipped on manually once the
-- user has verified the feature against a real, live Supabase run.
--
-- geo_intelligence: "pick a cluster, see its rainfall history, production
-- concentration and market access in one place" — scoped to the 29 weather
-- clusters (24 original + 5 added in migration 0010). Rainfall history is
-- genuinely cluster-specific (aggregated from observed_hourly). Production
-- and market-access figures are NOT cluster-specific — production_conditions
-- (FAOSTAT) and commodity_prices (NBS/World Bank RTFP/AFEX/FEWS NET) are both
-- national-level sources with no sub-national breakdown — so, per the user's
-- explicit choice, those panels show the real national figures for commodities
-- associated with the selected cluster (see
-- src/lib/domains/geo-intelligence/cluster-commodities.ts), clearly labeled
-- "national-level, not cluster-specific" rather than hidden or fabricated.
--
-- crop_calendar: "a proper agricultural calendar tying weather observations to
-- planting/harvest seasons by crop" — a static, general-agronomic planting/
-- harvest reference per geo-zone (src/lib/domains/crop-calendar/calendar-data.ts),
-- overlaid with the weather domain's own recently observed rainfall for that
-- zone as current-conditions context. This deliberately does NOT compute an
-- "early/late vs normal" verdict — there is no verified historical
-- climatological baseline in this database to compare against, so inventing
-- one would overclaim precision the product doesn't have. The recent-rainfall
-- panel is shown as "current conditions", not as a deviation from a norm.
-- ============================================================================

insert into public.feature_flags (key, enabled) values
  ('geo_intelligence', false),
  ('crop_calendar', false)
on conflict (key) do nothing;
