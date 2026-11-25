-- ============================================================================
-- Migration 0006: FEWS NET as commodity_prices' third automated source, and
-- a new food_security domain (HDX HAPI — IPC/Cadre Harmonisé acute food
-- insecurity classification for Nigeria).
--
-- Both are explicitly requested by the user but explicitly kept OFF
-- (feature_flags seeded false, same cautious-default pattern as every
-- other domain in this build) until they've evaluated how the data fits
-- into the product — see claude/gic-phase-1-build-plan.md and the chat
-- history around this migration's date. Each gets its OWN flag key,
-- independent of the existing commodity_prices flag: flipping
-- commodity_prices on (because NBS/World Bank RTFP data is ready) must
-- NOT also surface FEWS NET data the user hasn't separately reviewed yet.
-- See src/components/CommodityPricesCard.tsx for how that independent gate
-- is applied at read time (FEWS_NET rows are always ingested and stored,
-- just excluded from the reconciled view while its own flag is off).
-- ============================================================================

-- 1. Widen commodity_price_observations' source check constraint to allow
--    'FEWS_NET' alongside the existing 'NBS'/'WORLD_BANK_RTFP' values. The
--    constraint name below is Postgres's default auto-generated name for a
--    column-level CHECK (<table>_<column>_check) as created in migration
--    0005; if a prior manual change renamed it, this DROP is a no-op
--    (IF EXISTS) and the ADD below still runs, surfacing a clear duplicate-
--    constraint error rather than silently leaving the old, narrower
--    constraint in place.
alter table public.commodity_price_observations
  drop constraint if exists commodity_price_observations_source_check;

alter table public.commodity_price_observations
  add constraint commodity_price_observations_source_check
  check (source in ('NBS', 'WORLD_BANK_RTFP', 'FEWS_NET'));

-- 2. food_security_observations — HDX HAPI's IPC/Cadre Harmonisé
--    classification rows for Nigeria, at national/admin1/admin2 level.
--
--    admin1_code/admin1_name/admin2_code/admin2_name are NOT NULL with a
--    '' default (never left NULL) deliberately: Postgres treats two NULLs
--    as distinct for uniqueness purposes, so a unique constraint including
--    a nullable admin1_code/admin2_code would silently fail to prevent
--    duplicate rows for national-level observations (admin_level='0',
--    where both are legitimately absent) on every re-ingest. Coalescing to
--    '' at the application layer (see food-security/backfill.ts) keeps the
--    unique constraint meaningful for every admin_level.
create table if not exists public.food_security_observations (
  id bigint generated always as identity primary key,
  location_code text not null default 'NGA',
  location_name text not null default 'Nigeria',
  admin_level text not null default '0',
  admin1_code text not null default '',
  admin1_name text not null default '',
  admin2_code text not null default '',
  admin2_name text not null default '',
  -- IPC phase: '1' (minimal) through '5' (famine), or 'all' for the total
  -- population row (phase fractions may not sum exactly to 1 — HDX HAPI's
  -- own documented caveat, not an ingestion bug if seen).
  ipc_phase text not null,
  -- 'current' | 'first projection' | 'second projection' (HDX HAPI's own
  -- terms) — kept as free text rather than an enum since HDX HAPI is
  -- explicitly in beta and may add projection types.
  ipc_type text not null,
  population_in_phase numeric,
  population_fraction_in_phase numeric,
  reference_period_start date not null,
  reference_period_end date not null,
  resource_hdx_id text,
  ingested_at timestamptz not null default now(),
  unique (location_code, admin1_code, admin2_code, ipc_phase, ipc_type, reference_period_start)
);

create index if not exists food_security_observations_period_idx
  on public.food_security_observations (reference_period_start);

alter table public.food_security_observations enable row level security;

drop policy if exists "Public read food security observations" on public.food_security_observations;
create policy "Public read food security observations" on public.food_security_observations
  for select using (true);

revoke insert, update, delete on public.food_security_observations from anon, authenticated;

-- 3. feature_flags — both kept dark (false) until the user explicitly
--    verifies the data and flips them on manually via Supabase, matching
--    0004's and 0005's existing cautious-default pattern.
insert into public.feature_flags (key, enabled) values
  ('food_security', false),
  ('commodity_prices_fewsnet', false)
on conflict (key) do nothing;
