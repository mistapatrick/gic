-- ============================================================================
-- Migration 0002: authentication, roles, immutable audit trail, feature flags.
--
-- First introduction of real user authentication to this codebase. Everything
-- up to and including migration 0001 (and schema.sql) was a fully public,
-- read-only weather telemetry product with no accounts at all; writes went
-- through the service_role key from a single cron-authenticated route.
--
-- This migration adds:
--   1. user_roles       — one row per human account, assigning a role
--                          (super_admin | data_entry) and, for data_entry
--                          accounts, which domain(s) they may write to.
--   2. is_super_admin()  — a SECURITY DEFINER helper so RLS policies on any
--                          table can check "is the calling user a super
--                          admin?" without themselves needing SELECT on
--                          user_roles (which would be circular).
--   3. audit_log         — append-only. No update or delete policy exists for
--                          ANY role, including super_admin, by design: an
--                          audit trail you can edit isn't an audit trail.
--                          Only the service-role-backed API route (via
--                          src/lib/audit.ts) ever inserts into it.
--   4. feature_flags     — the kill-switch table referenced throughout the
--                          GIC build plan: each data domain checks its own
--                          flag before rendering/ingesting, so a
--                          misbehaving or not-yet-ready domain can be pulled
--                          from public view without a redeploy.
--
-- Run this once, after schema.sql, against a fresh Supabase project (this is
-- a brand-new project for GIC, deliberately separate from the original
-- weather-telemetry pilot's Supabase project — see README.md).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Roles
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.gic_role as enum ('super_admin', 'data_entry');
exception when duplicate_object then null;
end $$;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.gic_role not null,
  -- Which data domain(s) a data_entry account may write to, e.g.
  -- '{input_pricing}' or '{crop_pest}'. Null/empty for super_admin, who is
  -- not domain-scoped (full account-management access instead — see
  -- is_super_admin() below, not a domain grant).
  domain_scope text[] not null default '{}',
  active boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

-- SECURITY DEFINER: reads user_roles with the function owner's privileges,
-- bypassing RLS, specifically so this can be called FROM another table's RLS
-- policy without that policy needing its own grant on user_roles (which
-- would otherwise be circular — you'd need to already know the caller is an
-- admin to grant them permission to check whether they're an admin).
create or replace function public.is_super_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'super_admin' and active = true
  );
$$;

create or replace function public.has_domain_scope(required_domain text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role = 'data_entry'
      and active = true
      and required_domain = any (domain_scope)
  );
$$;

-- Only a super admin may ever read the role table directly (the account
-- creation/listing UI runs as super admin). No insert/update/delete policy
-- is granted to anon or authenticated at all — every write to this table
-- goes through the service_role-backed /api/admin/accounts route, which
-- also writes the audit_log row in the same request. This is the "Admin
-- Mass-Assignment Guard" and "Object-Level Authorization" checklist items
-- applied to the account-creation surface itself.
drop policy if exists "Super admins read roles" on public.user_roles;
create policy "Super admins read roles" on public.user_roles
  for select using (public.is_super_admin());

-- A signed-in account also needs to read its OWN row — e.g. the app has to
-- know a data_entry user's own domain_scope to decide what to show them.
-- This does not let anyone read another account's row (that still requires
-- is_super_admin() above); it only ever matches auth.uid() to itself.
drop policy if exists "Users read own role row" on public.user_roles;
create policy "Users read own role row" on public.user_roles
  for select using (user_id = auth.uid());

revoke insert, update, delete on public.user_roles from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Audit log — append-only, no edit path for anyone
-- ----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id),
  action text not null,
  target_table text,
  target_id text,
  changed_fields jsonb,
  outcome text not null check (outcome in ('success', 'failure')),
  created_at timestamptz not null default now()
);

create index if not exists audit_log_actor_idx on public.audit_log (actor_id);
create index if not exists audit_log_created_at_idx on public.audit_log (created_at);

alter table public.audit_log enable row level security;

drop policy if exists "Super admins read audit log" on public.audit_log;
create policy "Super admins read audit log" on public.audit_log
  for select using (public.is_super_admin());

-- Deliberately no insert policy for anon/authenticated either — only the
-- service_role client (which bypasses RLS) ever inserts, from
-- src/lib/audit.ts, so every audit row reflects a server-validated action.
revoke insert, update, delete on public.audit_log from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Feature flags — public read (the app needs to check these to decide
--    what to render), writes only via service_role (the admin UI).
-- ----------------------------------------------------------------------------
create table if not exists public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;

drop policy if exists "Public read feature flags" on public.feature_flags;
create policy "Public read feature flags" on public.feature_flags
  for select using (true);

revoke insert, update, delete on public.feature_flags from anon, authenticated;

-- Seed the flags already decided in the GIC Phase 1 synopsis: input pricing
-- and crop pest/disease tracking are built but kept dark until personnel are
-- in place; livestock/aquatic outbreak tracking (WAHIS) ships live. These
-- three rows are placeholders now — the domains themselves land in later
-- sub-phases — seeded here so every later sub-phase can assume the flag
-- already exists rather than each one adding its own seed statement.
insert into public.feature_flags (key, enabled) values
  ('input_pricing', false),
  ('crop_pest_tracking', false),
  ('livestock_outbreak_tracking', true)
on conflict (key) do nothing;
