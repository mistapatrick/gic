-- ============================================================================
-- Migration 0005: Automate NBS and World Bank RTFP commodity pricing.
--
-- Supersedes part of Sub-phase 2's original scope decision. That decision
-- (see migration 0004's header and claude/gic-phase-1-build-plan.md) was
-- "don't automate AFEX or World Bank RTFP yet; treat NBS as manual-entry" —
-- made after researching each source's real-world access method. The user
-- has since clarified that the original Phase-1 plan (AFEX + World Bank
-- RTFP + NBS + FAOSTAT, all with weekly ingestion) is what they actually
-- want, and asked specifically for NBS and World Bank RTFP to be automated.
--
-- Re-researching access methods found:
--   - NBS Selected Food Price Watch: a monthly ZIP (report PDF + a
--     structured xlsx table) on a public microdata catalog, direct numbered
--     download links, no login step evident. Automatable.
--   - World Bank RTFP: a dated CSV on the same kind of public microdata
--     catalog platform, the dataset's own access policy states it is
--     "published as open data." Automatable, with the same category of
--     caveat production_conditions already carries for FAOSTAT's area
--     code — the exact download-link and column layout could not be
--     independently confirmed from this build environment (the sandbox's
--     own network allowlist blocks both nigerianstat.gov.ng and
--     worldbank.org directly), so both ingestors validate defensively and
--     throw rather than silently mis-file if a live response doesn't look
--     like what's expected. See SECURITY.md for the full writeup.
--   - AFEX: still has no official API, developer portal, or documented
--     data feed anywhere — stays on the manual-entry framework built in
--     migration 0004, per the user's explicit choice.
--
-- This migration adds ONE new table for the two newly-automated sources.
-- AFEX (and any ad hoc "OTHER" source) keeps using manual_data_entries
-- unchanged — see src/lib/domains/commodity-prices/reconcile.ts for how
-- the two tables are merged at read time into one reconciled view, with
-- each source's own figure kept visible alongside any cross-agency
-- average.
-- ============================================================================

create table if not exists public.commodity_price_observations (
  id bigint generated always as identity primary key,
  commodity text not null,
  source text not null check (source in ('NBS', 'WORLD_BANK_RTFP')),
  -- 'retail': household/market survey price (NBS, World Bank RTFP both
  -- measure this). 'exchange_spot'/'wholesale'/'farmgate' are reserved for
  -- future automated sources (AFEX, if it ever gets a real access path) —
  -- deliberately not collapsed into one undifferentiated "price" column,
  -- because averaging a retail price with an exchange spot price would be
  -- comparing different things and would mislead anyone reading the
  -- reconciled figure. See reconcile.ts for how this field gates averaging.
  price_type text not null check (price_type in ('retail', 'wholesale', 'exchange_spot', 'farmgate')),
  value numeric not null,
  unit text not null,
  currency text not null default 'NGN',
  -- The month/date the observation itself pertains to (NBS: the report
  -- month; World Bank RTFP: the dataset's own DATES column) — distinct
  -- from ingested_at, which is when GIC pulled it.
  period_date date not null,
  region text not null default 'National',
  -- The source's own original item/column label, kept verbatim for
  -- traceability and so a reader can see exactly what was measured (e.g.
  -- NBS's "Rice local sold loose 1kg" vs FAOSTAT's "Rice, paddy" are not
  -- the same product stage, even though both roll up under GIC's "Rice
  -- (paddy)" commodity label for cross-domain navigation).
  raw_item_label text,
  ingested_at timestamptz not null default now(),
  -- One row per (commodity, source, price_type, period_date, region) —
  -- re-running the weekly cron, or a backfill chunk that overlaps an
  -- already-ingested period, upserts the same row instead of accumulating
  -- duplicates. Matches production_conditions' idempotency pattern.
  unique (commodity, source, price_type, period_date, region)
);

create index if not exists commodity_price_observations_commodity_idx
  on public.commodity_price_observations (commodity, period_date);

alter table public.commodity_price_observations enable row level security;

drop policy if exists "Public read commodity price observations" on public.commodity_price_observations;
create policy "Public read commodity price observations" on public.commodity_price_observations
  for select using (true);

revoke insert, update, delete on public.commodity_price_observations from anon, authenticated;
