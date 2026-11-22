-- ============================================================================
-- Migration 0001: widen daily_observed_reports.cutoff_hour_wat to the full
-- day (0-23), now that ingestion runs at 23:59 WAT instead of 22:00 WAT.
--
-- Run this ONCE in the Supabase SQL Editor against your existing Growthly Intelligence Centre
-- deployment, before you deploy the updated application code. A brand-new
-- deployment (running supabase/schema.sql for the first time) does not need
-- this file — schema.sql already creates the column with the wider check.
--
-- Why this is needed: the original column was declared
--   cutoff_hour_wat int not null default 21 check (cutoff_hour_wat between 0 and 21)
-- With ingestion now capturing the full day, the route will try to upsert
-- cutoff_hour_wat = 22 or 23, which the old CHECK constraint rejects outright
-- — every nightly run would fail at the final "Database write failed" step
-- without this migration.
-- ============================================================================

-- Postgres auto-names an inline, unnamed CHECK constraint as
-- "<table>_<column>_check" — that's the constraint schema.sql's original
-- `check (cutoff_hour_wat between 0 and 21)` produced.
alter table public.daily_observed_reports
  drop constraint if exists daily_observed_reports_cutoff_hour_wat_check;

alter table public.daily_observed_reports
  add constraint daily_observed_reports_cutoff_hour_wat_check
  check (cutoff_hour_wat between 0 and 23);

alter table public.daily_observed_reports
  alter column cutoff_hour_wat set default 23;
