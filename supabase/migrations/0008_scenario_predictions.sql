-- ============================================================================
-- Run this once, in order, after 0001-0007, against the same Supabase
-- project 0001-0007 already ran against.
--
-- Migration 0008: scenario_predictions + prediction_outcomes — the Step 1
-- "basic components" foundation for GIC's Modelling/Adaptation/Intelligence
-- stages (stages 3-5 of the Data -> Insight -> Modelling -> Adaptation ->
-- Intelligence loop; see claude/gic-phase-1-synopsis.md's "Core framing"
-- section, and Sub-phase 6/7 in claude/gic-phase-1-build-plan.md).
--
-- Column shapes below match the synopsis doc's own prediction-tracking
-- schema design exactly (signal_source_table, signal_source_id, commodity,
-- region, agriculture_type, branch, predicted_range_low/high, unit,
-- narrative, confidence_label, predicted_at, target_resolution_date,
-- resolution_metric, status for scenario_predictions; prediction_id,
-- observed_value, observed_date, observed_source, within_range,
-- divergence_pct, resolved_at for prediction_outcomes) rather than inventing
-- a new shape, so this foundation matches what was already specified.
--
-- Scope: schema only. No domain is wired to write here yet — that's Step 2
-- (piloting src/lib/scenarios/ against production_conditions AND
-- commodity_prices), not started as of this migration. RLS follows this
-- codebase's existing convention for every other domain table
-- (production_conditions, commodity_price_observations,
-- food_security_observations): public read, service-role-write-only. This
-- also matches the synopsis's own stated intent that the calibration record
-- becomes a public trust asset once a season of predictions has resolved —
-- public read is the right default from the start rather than something to
-- retrofit later.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. scenario_predictions — logged at the moment the shared scenario module
--    (src/lib/scenarios/) generates a branch set for some domain's data.
--
--    signal_source_table/signal_source_id point at the row(s) the scenario
--    was generated from (e.g. signal_source_table='production_conditions',
--    signal_source_id=<that table's bigint id>). This is a loose reference,
--    not a foreign key: the same two columns are reused across every
--    domain's differently-shaped source table, so a single FK target isn't
--    possible. signal_source_id is bigint (not uuid) to match every
--    existing domain table's own bigint-identity primary key
--    (production_conditions.id, commodity_price_observations.id, etc.) —
--    kept consistent with the table it's actually pointing at, even though
--    the database itself can't enforce that at the constraint level.
--
--    branch is constrained to the three values the synopsis names
--    explicitly (do_nothing / act_a / act_b) — not the looser "3-4 outcomes"
--    language used loosely in chat — so every generated scenario set is
--    exactly these three branches, consistently comparable across domains
--    and over time.
-- ----------------------------------------------------------------------------
create table if not exists public.scenario_predictions (
  id bigint generated always as identity primary key,
  signal_source_table text not null,
  signal_source_id bigint,
  commodity text not null,
  region text not null default 'National',
  agriculture_type text not null check (agriculture_type in ('crop', 'livestock', 'fishery')),
  branch text not null check (branch in ('do_nothing', 'act_a', 'act_b')),
  narrative text not null,
  predicted_range_low numeric,
  predicted_range_high numeric,
  unit text,
  confidence_label text not null check (confidence_label in ('low', 'moderate', 'high')),
  force_majeure_caveat text not null,
  predicted_at timestamptz not null default now(),
  target_resolution_date date not null,
  resolution_metric text not null,
  -- 'active': generated, not yet past its target_resolution_date.
  -- 'resolved': a prediction_outcomes row exists for it.
  -- 'superseded': Step 3 (Adaptation, not yet built) will use this for a
  -- prediction whose underlying data shifted enough that a fresh scenario
  -- was generated in its place — the original stays on the record rather
  -- than being overwritten, so the original call can still be graded fairly.
  status text not null default 'active' check (status in ('active', 'resolved', 'superseded')),
  created_at timestamptz not null default now()
);

create index if not exists scenario_predictions_status_resolution_idx
  on public.scenario_predictions (status, target_resolution_date);
create index if not exists scenario_predictions_commodity_idx
  on public.scenario_predictions (commodity, region);

alter table public.scenario_predictions enable row level security;

drop policy if exists "Public read scenario predictions" on public.scenario_predictions;
create policy "Public read scenario predictions" on public.scenario_predictions
  for select using (true);

revoke insert, update, delete on public.scenario_predictions from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. prediction_outcomes — written once a prediction's target_resolution_date
--    has passed and Sub-phase 7's resolution job (not yet built — needs a
--    live web-search capability wired into the deployed app, a genuine open
--    technical question, not just an engineering task; see the synopsis's
--    "Core framing" section) has checked it against what actually happened.
--
--    One prediction can only resolve once — the unique constraint on
--    prediction_id reflects that a prediction is graded a single time, not
--    re-graded repeatedly. A correction, if ever needed, is a new row in
--    scenario_predictions (via the 'superseded' status above), not a second
--    row here against the same prediction.
-- ----------------------------------------------------------------------------
create table if not exists public.prediction_outcomes (
  id bigint generated always as identity primary key,
  prediction_id bigint not null references public.scenario_predictions (id),
  observed_value numeric,
  observed_narrative text,
  observed_date date,
  observed_source text,
  within_range boolean,
  divergence_pct numeric,
  resolved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (prediction_id)
);

create index if not exists prediction_outcomes_prediction_id_idx
  on public.prediction_outcomes (prediction_id);

alter table public.prediction_outcomes enable row level security;

drop policy if exists "Public read prediction outcomes" on public.prediction_outcomes;
create policy "Public read prediction outcomes" on public.prediction_outcomes
  for select using (true);

revoke insert, update, delete on public.prediction_outcomes from anon, authenticated;
