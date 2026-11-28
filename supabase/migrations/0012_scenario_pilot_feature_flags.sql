-- ============================================================================
-- Migration 0012: feature flags for Sub-phase 6 Step 2 — the scenario-engine
-- pilot on production_conditions and commodity_prices (see
-- claude/gic-phase-1-build-plan.md, "Sub-phase 6" / "Step 2"). Both start
-- disabled (false), same cautious-by-default posture every other domain's
-- flag has used since migration 0004: flip one on only after verifying a
-- real "Generate Business Scenarios" run against this project's own live
-- Supabase + AI keys.
--
-- Two flags, not one, matching every other per-domain flag in this codebase
-- (production_conditions, commodity_prices, geo_intelligence,
-- crop_calendar, ...): production_conditions_scenarios gates the button on
-- the Produce Stats card, commodity_prices_scenarios gates the equivalent
-- button on the Commodity Prices card. A failure or a deliberate pause on
-- one domain's pilot never has to take the other's button down too.
--
-- Unlike every other flag so far, this one also gates an AI-GENERATION
-- write path (POST /api/scenarios/{production-conditions,commodity-prices},
-- see those routes), not just a read-only display. Both routes re-check
-- their own flag server-side before calling the AI/writing
-- scenario_predictions — the client-side check that hides the button is
-- not the only gate.
-- ============================================================================

insert into public.feature_flags (key, enabled) values
  ('production_conditions_scenarios', false),
  ('commodity_prices_scenarios', false)
on conflict (key) do nothing;
