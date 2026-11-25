-- ============================================================================
-- Migration 0009: let super_admin perform manual-entry functions directly,
-- not only assign them to other accounts.
--
-- Context: has_domain_scope() (0002_auth_roles_audit.sql) was written to
-- check `role = 'data_entry' ... and required_domain = any(domain_scope)`
-- only — a super_admin's own domain_scope column is always '{}' (the
-- column was only ever meant for data_entry accounts; a super admin's
-- access was "full account-management access instead", per that
-- migration's own comment). Every RLS policy built on has_domain_scope()
-- — today that's manual_data_entries' "Scoped data entry accounts insert
-- pending entries" INSERT policy (0004_production_conditions_and_manual_
-- entries.sql) — therefore rejected a super_admin's own insert, even
-- though is_super_admin() already bypasses plenty of other RLS checks in
-- this schema (e.g. manual_data_entries' own "Super admins read all
-- manual entries" SELECT policy).
--
-- This migration adds that same bypass to has_domain_scope() itself,
-- rather than duplicating "or is_super_admin()" into every policy that
-- calls it — so a super_admin passes a has_domain_scope(<any domain>)
-- check exactly as a data_entry account scoped to that domain would, now
-- and for any future domain or policy built on this function. The
-- application-layer half of this (getCurrentUserRole() synthesizing a
-- super_admin's own domainScope as every DATA_ENTRY_DOMAINS value, so the
-- UI actually shows the entry forms) lives in
-- src/lib/supabase/server.ts — that comment cross-references this one.
--
-- Run this once, in order, after 0001-0008, against the same Supabase
-- project those already ran against.
-- ============================================================================

create or replace function public.has_domain_scope(required_domain text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.is_super_admin()
    or exists (
      select 1 from public.user_roles
      where user_id = auth.uid()
        and role = 'data_entry'
        and active = true
        and required_domain = any (domain_scope)
    );
$$;
