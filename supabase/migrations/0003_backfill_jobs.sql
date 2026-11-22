-- ============================================================================
-- Migration 0003: historical-backfill job tracking.
--
-- The "retrieve historical data before commencement of GIC" provision,
-- generalised across every data domain rather than hardcoded to weather.
-- backfill_jobs is the persisted checkpoint that makes a backfill resumable
-- across separate serverless invocations: Vercel's free-tier 60s
-- maxDuration ceiling means a multi-year historical pull can never complete
-- in one request, so progress (cursor_date) is written back to this table
-- after every chunk, and the next invocation picks up exactly where the
-- last one stopped — see src/lib/ingestion/backfill-framework.ts.
-- ============================================================================

create table if not exists public.backfill_jobs (
  id bigint generated always as identity primary key,
  domain text not null,
  range_start date not null,
  range_end date not null,
  -- Next date still to be fetched. The job is complete once cursor_date
  -- moves past range_end. Starts equal to range_start.
  cursor_date date not null,
  chunk_size_days int not null default 7 check (chunk_size_days > 0),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  rows_written bigint not null default 0,
  last_error text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One job per (domain, range) — re-requesting the same backfill resumes
  -- the existing row (via upsert in the route handler) instead of starting
  -- a parallel duplicate that would double-write the same date range.
  unique (domain, range_start, range_end)
);

create index if not exists backfill_jobs_domain_status_idx
  on public.backfill_jobs (domain, status);

alter table public.backfill_jobs enable row level security;

drop policy if exists "Super admins read backfill jobs" on public.backfill_jobs;
create policy "Super admins read backfill jobs" on public.backfill_jobs
  for select using (public.is_super_admin());

-- No insert/update/delete policy for anon/authenticated — only the
-- service_role client (src/lib/ingestion/backfill-framework.ts, called from
-- the super-admin-gated /api/admin/backfill route) ever writes here.
revoke insert, update, delete on public.backfill_jobs from anon, authenticated;
