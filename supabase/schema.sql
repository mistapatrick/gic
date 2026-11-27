-- ============================================================================
-- Growthly Intelligence Centre — Supabase schema
-- A Growthly Nexus Solutions Limited data product.
--
-- Security model:
--   * All three tables are PUBLIC READ-ONLY. RLS is enabled and the only
--     policies granted are `select ... using (true)`.
--   * There is deliberately NO insert/update/delete policy for the `anon` or
--     `authenticated` roles. With RLS enabled and no matching policy, those
--     roles cannot write — full stop. The explicit REVOKE statements below
--     are defense-in-depth on top of that (belt and suspenders), in case a
--     future migration ever grants table privileges directly.
--   * All writes come from the Next.js /api/ingest route using the
--     `service_role` key, which bypasses RLS by Supabase design and is never
--     exposed to the browser (see src/lib/supabase.ts and .env.example).
--   * Every table that accepts numeric observational data carries CHECK
--     constraints so a malformed upstream reading (e.g. a negative wind
--     speed, or humidity > 100%) is rejected at the database layer rather
--     than silently corrupting the dashboard.
--   * `unique (cluster_id, obs_date, obs_hour)` + `on conflict (...) upsert`
--     in the ingest route is what makes nightly ingestion idempotent: running
--     the same night's ingestion twice (e.g. a retried GitHub Actions run)
--     overwrites the same row instead of creating duplicates.
-- ============================================================================

-- 1. Static registry of the agricultural clusters (24 seeded below; 5 more
--    added by migration 0010, bringing the total to 29)
create table if not exists public.weather_clusters (
  id serial primary key,
  slug text unique not null,
  state_label text not null,
  cluster_name text not null,
  geo_zone text not null check (
    geo_zone in (
      'South-East', 'South-South', 'North-West',
      'North-East', 'North-Central', 'South-West'
    )
  ),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180)
);

-- 2. Hourly experienced/observed telemetry (00:00 to 23:00 WAT, full day)
create table if not exists public.observed_hourly (
  id bigint generated always as identity primary key,
  cluster_id int not null references public.weather_clusters (id) on delete cascade,
  obs_date date not null,
  obs_hour int not null check (obs_hour between 0 and 23),
  temp_2m_c real not null check (temp_2m_c between -10 and 60),
  rel_humidity_pct real not null check (rel_humidity_pct between 0 and 100),
  precip_mm real not null check (precip_mm >= 0),
  wind_speed_kmh real not null check (wind_speed_kmh >= 0),
  sunshine_hrs real not null default 0 check (sunshine_hrs between 0 and 1),
  created_at timestamptz not null default now(),
  unique (cluster_id, obs_date, obs_hour)
);

create index if not exists observed_hourly_obs_date_idx
  on public.observed_hourly (obs_date);

-- 3. Daily observed summary & AI agro-met brief (updated nightly at 23:59 WAT)
create table if not exists public.daily_observed_reports (
  id bigint generated always as identity primary key,
  obs_date date unique not null,
  cutoff_hour_wat int not null default 23 check (cutoff_hour_wat between 0 and 23),
  national_summary text not null,
  regional_insights jsonb not null,
  cluster_metrics jsonb not null,
  generated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Row-Level Security: public read-only, writes via service_role only
-- ----------------------------------------------------------------------------
alter table public.weather_clusters enable row level security;
alter table public.observed_hourly enable row level security;
alter table public.daily_observed_reports enable row level security;

drop policy if exists "Public read clusters" on public.weather_clusters;
drop policy if exists "Public read hourly" on public.observed_hourly;
drop policy if exists "Public read reports" on public.daily_observed_reports;

create policy "Public read clusters" on public.weather_clusters
  for select using (true);

create policy "Public read hourly" on public.observed_hourly
  for select using (true);

create policy "Public read reports" on public.daily_observed_reports
  for select using (true);

-- Defense-in-depth: explicitly strip write privileges from the client-facing
-- roles. The service_role used by the ingest route bypasses RLS and table
-- grants entirely, so this has no effect on the nightly ingestion job.
revoke insert, update, delete on public.weather_clusters from anon, authenticated;
revoke insert, update, delete on public.observed_hourly from anon, authenticated;
revoke insert, update, delete on public.daily_observed_reports from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Seed: the original 24 agricultural clusters (migration 0010 adds 5 more)
-- ----------------------------------------------------------------------------
insert into public.weather_clusters (slug, state_label, cluster_name, geo_zone, latitude, longitude) values
  ('anambra-ayamelum', 'Anambra', 'Ayamelum, Ogbaru, Anambra W.', 'South-East', 6.4512, 6.9124),
  ('ebonyi-abakaliki', 'Ebonyi', 'Abakaliki, Ikwo', 'South-East', 6.2468, 8.1135),
  ('enugu-adani', 'Enugu', 'Adani / Uzo-Uwani LGA', 'South-East', 6.7361, 7.0114),
  ('imo-abia', 'Imo & Abia', 'Imo & Abia Clusters', 'South-East', 5.4891, 7.2842),
  ('edo-ovia', 'Edo', 'Ovia, Uhunmwonde, Orhionmwon', 'South-South', 6.4215, 5.7890),
  ('cross-river-ikom', 'Cross River', 'Ikom, Obubra, Akamkpa', 'South-South', 5.9624, 8.7082),
  ('delta-ethiope', 'Delta', 'Ethiope, Ndokwa', 'South-South', 5.7145, 6.1823),
  ('akwa-ibom-rivers', 'Akwa Ibom & Rivers', 'Akwa Ibom & Rivers Clusters', 'South-South', 4.9218, 7.4512),
  ('kano-kadawa', 'Kano', 'Kano River Basin & Kadawa', 'North-West', 11.6442, 8.4319),
  ('kebbi-argungu', 'Kebbi', 'Argungu & Rima River Basin', 'North-West', 12.7448, 4.5251),
  ('jigawa-hadejia', 'Jigawa', 'Dutse & Hadejia Valley', 'North-West', 12.1642, 9.7518),
  ('zamfara-katsina', 'Zamfara & Katsina', 'Zamfara & Katsina Clusters', 'North-West', 12.4519, 7.1845),
  ('taraba-mambilla', 'Taraba', 'Mambilla & Benue Valley', 'North-East', 7.3512, 10.7841),
  ('gombe-yamaltu', 'Gombe', 'Yamaltu Deba & Billiri', 'North-East', 10.1245, 11.3418),
  ('adamawa-benue', 'Adamawa', 'Upper Benue Trough', 'North-East', 9.3265, 12.3984),
  ('borno-yobe', 'Borno & Yobe', 'Lake Chad Basin', 'North-East', 12.8412, 13.1542),
  ('benue-gboko', 'Benue', 'Gboko, Katsina-Ala, Ukum', 'North-Central', 7.3251, 9.0052),
  ('niger-mokwa', 'Niger', 'Mokwa, Badeggi, Bida', 'North-Central', 9.2928, 5.5412),
  ('nasarawa-doma', 'Nasarawa', 'Doma, Awe', 'North-Central', 8.3891, 8.3562),
  ('plateau-jos', 'Plateau', 'Jos Plateau', 'North-Central', 9.8965, 8.8583),
  ('ondo-idanre', 'Ondo', 'Idanre, Ondo Town, Owo', 'South-West', 7.1024, 5.1145),
  ('oyo-oke-ogun', 'Oyo', 'Iseyin, Saki / Oke-Ogun Zone', 'South-West', 8.3412, 3.4891),
  ('ogun-yewa', 'Ogun', 'Yewa, Ijebu North', 'South-West', 6.9542, 3.4128),
  ('ekiti-osun', 'Ekiti & Osun', 'Ekiti & Osun Clusters', 'South-West', 7.6214, 4.9812)
on conflict (slug) do nothing;

-- Realtime: after running this file, also enable Realtime for
-- public.daily_observed_reports in Supabase Dashboard -> Database ->
-- Replication (or Table Editor -> daily_observed_reports -> Enable Realtime)
-- so open browser tabs refresh live at 23:59 WAT without a page reload.
