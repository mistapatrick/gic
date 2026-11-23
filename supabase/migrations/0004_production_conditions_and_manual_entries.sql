-- ============================================================================
-- Migration 0004: Sub-phase 2 — production conditions (automated) and a
-- generic manual-entry framework (commodity prices is its first domain).
--
-- Scope decision behind this migration (see claude/gic-phase-1-build-plan.md
-- for the full history): Sub-phase 2 was originally scoped as two automated,
-- read-only ingestion domains (production conditions + commodity prices).
-- Researching the three candidate commodity-price sources found a genuine
-- divergence in feasibility — AFEX's live JSON endpoint is undocumented on
-- any official developer portal, World Bank RTFP is dated-CSV-snapshot and
-- registration-gated rather than a queryable API, and NBS's Food Price Watch
-- has no API at all (monthly PDF only). Put to the user, the decision was:
-- automate neither AFEX nor World Bank RTFP for now, and treat NBS as a
-- manual-entry domain instead. So this migration builds:
--
--   1. production_conditions — FAOSTAT-backed, machine-ingested, public
--      read-only. The one automated domain this sub-phase ships.
--   2. manual_data_entries   — a generic, domain-scoped, status-gated table.
--      NOT specific to commodity prices: designed so commodity_prices (added
--      here) and later sub-phases' input_pricing/crop_pest_tracking (already
--      reserved in DATA_ENTRY_DOMAINS, feature_flags) all reuse this one
--      table rather than each domain growing its own near-identical copy.
--
-- Run this once, in order, after 0001-0003, against the same Supabase
-- project 0001-0003 already ran against.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. production_conditions — FAOSTAT crop/livestock production data for
--    Nigeria. Public-read-only, service-role-write-only: the exact pattern
--    schema.sql already uses for weather_clusters/observed_hourly (see that
--    file's header comment) rather than an invented new convention.
--
--    faostat_area_code/item_code/element_code are kept (not just the
--    human-readable commodity/metric labels) purely for upstream
--    traceability — if FAOSTAT ever revises a series, or a figure needs to
--    be checked against the source API call that produced it, the exact
--    codes used are on the row, not just this ingest run's interpretation
--    of them. See src/lib/domains/production-conditions/ for the defensive
--    validation that checks every fetched row's own Area/ISO3 field
--    actually equals Nigeria before it ever reaches this table — the exact
--    numeric FAOSTAT area code for Nigeria could not be independently
--    confirmed outside a live deployed run (see build-plan doc), so that
--    validation — not a trusted hardcoded number — is what keeps a wrong
--    code from silently writing another country's data in here.
-- ----------------------------------------------------------------------------
create table if not exists public.production_conditions (
  id bigint generated always as identity primary key,
  commodity text not null,
  metric text not null check (metric in ('production_quantity', 'yield', 'area_harvested')),
  value numeric not null,
  unit text not null,
  year int not null check (year between 1960 and 2100),
  region text not null default 'National',
  source text not null default 'FAOSTAT',
  faostat_area_code int,
  faostat_item_code int,
  faostat_element_code int,
  ingested_at timestamptz not null default now(),
  -- One row per (commodity, metric, year, region) — re-running the weekly
  -- cron, or a backfill chunk that overlaps an already-ingested year,
  -- upserts the same row instead of accumulating duplicates.
  unique (commodity, metric, year, region)
);

create index if not exists production_conditions_commodity_year_idx
  on public.production_conditions (commodity, year);

alter table public.production_conditions enable row level security;

drop policy if exists "Public read production conditions" on public.production_conditions;
create policy "Public read production conditions" on public.production_conditions
  for select using (true);

revoke insert, update, delete on public.production_conditions from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. manual_data_entries — generic, reusable, domain-scoped manual entry
--    with a lightweight super-admin review gate before anything goes public.
--
--    "domain" is validated against DATA_ENTRY_DOMAINS
--    (src/lib/domains/registry.ts) at the application layer (Zod, in the
--    submission route) — not a DB-level check constraint — because that
--    list already grows across sub-phases and keeping one source of truth
--    in application code (rather than a second list here that could drift
--    out of sync) was the existing pattern for data_entry domain validation
--    before this migration.
--
--    "payload" is a jsonb blob rather than fixed columns because this table
--    is shared across domains with different shapes (a commodity-price
--    entry's fields are not an input-price entry's fields). Each domain
--    validates its own payload shape at the route layer (Zod) before
--    insert — see src/lib/domains/commodity-prices/entry-schema.ts for the
--    first such schema.
--
--    status workflow: every insert lands as 'pending' (enforced by the
--    insert policy's WITH CHECK below, not just a column default — a
--    data_entry account cannot submit a row that is born already
--    'published' no matter what the client sends). Only a super_admin can
--    move it to 'published' or 'rejected'. No delete policy for anyone,
--    matching audit_log/backfill_jobs: append-only, a rejected entry stays
--    as a visible rejected row rather than disappearing.
-- ----------------------------------------------------------------------------
create table if not exists public.manual_data_entries (
  id bigint generated always as identity primary key,
  domain text not null,
  payload jsonb not null,
  -- The date/period the entry's figures actually pertain to (e.g. the
  -- price's observation date) — distinct from created_at, which is when
  -- the row was submitted into GIC.
  entry_date date not null,
  entered_by uuid not null references auth.users (id),
  source_note text,
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists manual_data_entries_domain_status_idx
  on public.manual_data_entries (domain, status);
create index if not exists manual_data_entries_entered_by_idx
  on public.manual_data_entries (entered_by);

alter table public.manual_data_entries enable row level security;

-- Three separate SELECT policies (Postgres OR's multiple permissive
-- policies together for the same command) rather than one combined
-- condition, so each access path reads as its own named rule:
drop policy if exists "Public read published manual entries" on public.manual_data_entries;
create policy "Public read published manual entries" on public.manual_data_entries
  for select using (status = 'published');

drop policy if exists "Submitters read own manual entries" on public.manual_data_entries;
create policy "Submitters read own manual entries" on public.manual_data_entries
  for select using (entered_by = auth.uid());

drop policy if exists "Super admins read all manual entries" on public.manual_data_entries;
create policy "Super admins read all manual entries" on public.manual_data_entries
  for select using (public.is_super_admin());

-- A data_entry account scoped to this row's domain may insert — but only
-- ever as 'pending', as themselves, and the row's own domain_scope must
-- actually cover the domain being written to. This is the "every insert
-- lands pending" guarantee enforced at the database layer, not just by a
-- column default the client could override.
drop policy if exists "Scoped data entry accounts insert pending entries" on public.manual_data_entries;
create policy "Scoped data entry accounts insert pending entries" on public.manual_data_entries
  for insert with check (
    status = 'pending'
    and entered_by = auth.uid()
    and public.has_domain_scope(domain)
  );

-- Only a super admin may update a row — the review action (pending ->
-- published/rejected, setting reviewed_by/reviewed_at). A data_entry
-- account cannot edit its own submission after the fact; a correction is a
-- new submission, keeping the review trail honest.
drop policy if exists "Super admins review manual entries" on public.manual_data_entries;
create policy "Super admins review manual entries" on public.manual_data_entries
  for update using (public.is_super_admin()) with check (public.is_super_admin());

-- No delete policy for anyone — matches audit_log/backfill_jobs precedent.
revoke delete on public.manual_data_entries from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. feature_flags — both kept dark (false) until the user explicitly
--    verifies a working ingest/entry flow in their deployed environment and
--    flips them on manually via Supabase, matching 0002's existing
--    cautious-default pattern for not-yet-staffed/not-yet-proven domains.
-- ----------------------------------------------------------------------------
insert into public.feature_flags (key, enabled) values
  ('production_conditions', false),
  ('commodity_prices', false)
on conflict (key) do nothing;
