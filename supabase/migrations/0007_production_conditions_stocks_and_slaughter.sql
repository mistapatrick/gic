-- ============================================================================
-- Migration 0007: widen production_conditions.metric to accept the two
-- livestock-only FAOSTAT QCL elements ("Stocks" and "Producing
-- Animals/Slaughtered"), on top of the three already supported
-- (production_quantity, yield, area_harvested).
--
-- Requested so Cattle meat / Cow milk rows carry herd-size (stocks) and
-- slaughtered/producing-animal counts, not just production quantity — see
-- src/lib/domains/production-conditions/ingest-logic.ts's
-- ELEMENT_METRIC_RULES for the matching logic and its caveat on the exact
-- FAOSTAT element-name wording not being independently confirmable from
-- this sandbox.
--
-- Run this once, after 0001-0006, against the same Supabase project.
-- ============================================================================

-- The "production_conditions_metric_check" name follows Postgres's default
-- auto-naming for an inline column check (<table>_<column>_check) — the
-- same naming assumption migration 0006 already made for
-- commodity_price_observations' source check, and the same fallback
-- applies: if this name is wrong, DROP CONSTRAINT IF EXISTS is a silent
-- no-op and ADD CONSTRAINT then fails loudly with a duplicate-constraint
-- error rather than silently leaving the old, narrower constraint in place.
alter table public.production_conditions
  drop constraint if exists production_conditions_metric_check;
alter table public.production_conditions
  add constraint production_conditions_metric_check
  check (metric in (
    'production_quantity',
    'yield',
    'area_harvested',
    'stocks',
    'producing_animals_slaughtered'
  ));
