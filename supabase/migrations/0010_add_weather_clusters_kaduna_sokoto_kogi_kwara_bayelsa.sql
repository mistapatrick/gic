-- ============================================================================
-- Migration 0010: add 5 weather clusters for states the original 24-cluster
-- seed (schema.sql) left uncovered: Kaduna, Sokoto, Kogi, Kwara, Bayelsa.
--
-- Context: the original 24 clusters (schema.sql) cover 29 of Nigeria's 36
-- states, picked as named agricultural sub-regions rather than one per
-- state. Reviewing the gap for the planned geo-intelligence feature (pick a
-- cluster, see its rainfall history alongside national production/price
-- context) surfaced five materially significant production states with no
-- cluster at all, confirmed by the user to be added:
--   - Kaduna produces over 70% of Nigeria's ginger, concentrated in Kachia,
--     Jaba, and Kagarko LGAs (the Kaduna-ginger commodity tracked in
--     production_conditions since 2026-11-26 has no cluster representing
--     its own home state).
--   - Sokoto is the other half of the Sokoto-Rima Basin irrigation scheme
--     this doc already covers via Kebbi — rice and dry-season irrigated
--     farming around the Goronyo Dam / Middle Rima Valley Irrigation
--     Scheme (Goronyo, Gada, Wurno LGAs).
--   - Kogi sits at the Niger-Benue confluence and is one of Nigeria's
--     largest cassava producers, with growing rice production (Bassa,
--     Dekina, Ibaji LGAs).
--   - Kwara's Edu and Patigi LGAs are repeatedly cited in reporting as
--     among Nigeria's most productive rice-growing areas, along the Niger
--     River; Kaiama is a named maize/soybean area in the same belt.
--   - Bayelsa was the one South-South state the original 24 left out
--     entirely — riverine agriculture (yams, cassava, plantains, oil palm)
--     and fishing, centered on Ogbia and Southern Ijaw LGAs.
--
-- Coordinates are approximate centroids of the named LGAs (same precision
-- level as the original 24, which are hub locations, not survey points),
-- researched against named-LGA sources rather than guessed — the same
-- confidence-tier discipline already applied to TRACKED_COMMODITIES entries.
--
-- Mechanically this needs nothing beyond this INSERT: every ingestion path
-- (nightly cron, backfill framework, admin panel) already does
-- `select("*") from weather_clusters` with no hardcoded cluster list or
-- count. New clusters start receiving nightly ingestion from whenever this
-- migration is applied; their HISTORICAL weather still needs one manual
-- backfill run per cluster from the admin Backfill panel after deploying,
-- the same as any new domain's first backfill.
--
-- Run this once, in order, after 0001-0009, against the same Supabase
-- project those already ran against.
-- ============================================================================

insert into public.weather_clusters (slug, state_label, cluster_name, geo_zone, latitude, longitude) values
  ('kaduna-kachia', 'Kaduna', 'Kachia, Jaba, Kagarko (Ginger Belt)', 'North-West', 9.6621, 7.8188),
  ('sokoto-rima', 'Sokoto', 'Goronyo, Gada, Wurno (Rima Basin)', 'North-West', 13.3000, 5.5500),
  ('kogi-confluence', 'Kogi', 'Bassa, Dekina, Ibaji (Niger-Benue Confluence)', 'North-Central', 7.7000, 6.9000),
  ('kwara-edu-patigi', 'Kwara', 'Edu, Patigi, Kaiama (Niger River Rice Belt)', 'North-Central', 8.8000, 5.6000),
  ('bayelsa-ogbia', 'Bayelsa', 'Ogbia, Southern Ijaw', 'South-South', 4.7400, 6.1500)
on conflict (slug) do nothing;
