# Growthly Intelligence Centre (GIC)

A Growthly Nexus Solutions Limited data product. **Phase 1 of GIC is
agricultural intelligence** — continuously animated, **observed** (not
forecast) weather telemetry across 29 Nigerian agricultural clusters,
refreshed nightly at exactly 23:59 WAT (GMT+1), plus the account/admin
platform this document covers. GIC itself is broader than agriculture —
Phase 2 adds SME and Investment Intelligence, Phase 3 adds Risk Intelligence
and Research/AI Intelligence — but everything in this repository is Phase 1.

Built to run entirely on free tiers — Vercel Hobby, Supabase Free, GitHub
Actions, and the Google Gemini API free tier.

**This is a separate codebase and separate infrastructure from the earlier
AgroPulse NG pilot.** GIC has its own GitHub repository, its own Vercel
project, its own Supabase project, and its own Gemini/Groq API keys — none
of the pilot's credentials or git history carry over. The weather telemetry
pipeline itself (ingestion logic, risk-flag thresholds, Gemini fallback
handling, CSV/XLSX export, rate limiting) is the pilot's already-tested code,
carried forward unchanged and reorganized into `src/lib/domains/weather/`;
everything described under "Accounts, roles & admin" and "Historical
backfill" below is new in this repository.

## Who this is for

GIC's agricultural intelligence layer is **Growthly's internal
agro-climate intelligence layer**, not a public weather destination
competing with NiMet, FAO GIEWS, or CHIRPS for organic traffic. Its real
value is upstream of that: as the data layer behind what Growthly already
sells —

- **Bid differentiation** — a concrete, demoable "intelligence layer" asset
  to point to in BDSP/delivery-aggregator proposals (e.g. the Green RISE
  Africa bid), where competing proposals have no comparable data product.
- **Program and client briefings** — the per-cluster briefing card drops
  straight into a funder report, a cohort update, or a client email, with
  deterministic, citable risk flags rather than a vague weather summary.
- **Research raw material** — the same telemetry that feeds Growthly's
  Resilience & Resourcefulness studies and agricultural data-productization
  work, without re-keying anything by hand.

One important honesty note: for most of these 29 clusters, Open-Meteo's
"observed" data is a reanalysis/short-range model product (ERA5 / ERA5-Land
/ ECMWF IFS, blended against whatever stations exist nearby), not raw
synoptic station telemetry. Phrase claims to funders/clients as
"model-verified observed conditions," not "station-measured."

## What's in it

**Agricultural weather intelligence (the public dashboard):**

- **Live dashboard:** 7 animated graphs per cluster — rainfall, humidity,
  wind speed, average/max/min temperature, and sunshine hours — with a
  diurnal 00:00→23:00 WAT playback scrubber, responsive from phone to desktop.
- **Deterministic agronomic risk flags:** fixed-threshold rules (not the AI)
  compute per-cluster flags each night — heavy rainfall, drying/spoilage
  risk, heat stress, high wind — from that night's own totals. See
  `computeRiskFlags()` in `src/lib/domains/weather/ingest-logic.ts`. These
  are a first-pass heuristic model, not agronomically calibrated per crop;
  recalibrate the named threshold constants with Growthly's own agronomic
  input before citing them as authoritative.
- **Per-cluster briefing card:** a branded 1200×630 PNG (`/api/brief-card/
  [slug]`), built with `next/og` at zero added infrastructure.
- **AI observational brief:** Gemini Flash-Lite (free tier — primary
  `gemini-3.5-flash-lite`, falling back to `gemini-3.1-flash-lite` on a
  retryable error; see `src/lib/ai-models.ts`) reads the night's verified
  telemetry and writes a grounded, non-speculative summary plus an "Ask the
  analyst" Q&A drawer.
- **Exact nightly schedule:** a GitHub Actions cron calls `/api/ingest` at
  22:59 UTC / 23:59 WAT every night.
- **CSV/Excel export:** a public `/api/export` endpoint for observed
  telemetry over a chosen date range. See `SECURITY.md`.

**Platform (new in this repository — see the dedicated sections below):**

- **Real authentication**, via Supabase Auth — there is no self-service
  sign-up; every account is created by a super admin.
- **A super admin** who can invite scoped **data-entry accounts** — personnel
  who will manually fill in data that can't be machine-ingested (input
  pricing, crop pest/disease sightings, livestock outbreak reports) once
  those domains are built in later sub-phases.
- **An immutable audit log** of every account-management action.
- **A historical-backfill framework** — resumable, rate-limited, safe to
  stop and resume — for pulling in years of historical weather telemetry
  before the public dashboard's own numbers begin.
- **A modular domain structure** (`src/lib/domains/<domain>/`,
  `src/lib/ingestion/domain-adapters.ts`) so a new data domain's ingestion,
  UI, and backfill plug in without touching the weather domain's code, and a
  broken domain can be disabled via its `feature_flags` row without taking
  anything else down.
- **Security headers** including a nonce-based Content-Security-Policy —
  see `SECURITY.md` for how and why.

**Production conditions & commodity prices (Sub-phase 2):**

- **Production conditions** — FAOSTAT crop/livestock production, yield, and
  area-harvested figures for Nigeria, ingested automatically (annually, via
  a weekly cron that mostly no-ops between FAOSTAT's own release windows —
  see `src/lib/domains/production-conditions/`). Historical backfill
  reuses the same framework as weather, chunked in multi-year spans.
- **Commodity prices** — scoped to automate all three sources originally
  named (AFEX, World Bank RTFP, NBS) alongside FAOSTAT, and to average
  across agencies rather than pick one. After checking each source's
  real-world access method a second time: **NBS's Selected Food Price
  Watch and World Bank RTFP are now automated**, each via its own weekly
  cron and a dedicated `commodity_price_observations` table, alongside
  FAOSTAT's existing production-conditions figures — see
  `src/lib/domains/commodity-prices/`. **AFEX stays manual-entry.** AFEX
  has no official API or documented feed anywhere — only undocumented
  internal endpoints or third-party aggregators — so a scoped `data_entry`
  account still types in AFEX observations (commodity, market, price,
  unit) from `/dashboard`, a `super_admin` reviews and publishes or
  rejects them from `/admin`, and only published entries reach the
  public dashboard. See `src/lib/domains/manual-entries/` — a generic
  framework any future manual-entry domain reuses, not specific to
  prices.
- **Cross-agency reconciliation** — `reconcileCommodityPrices()` in
  `src/lib/domains/commodity-prices/price-types.ts` groups observations
  by commodity + price type + unit + currency + region, takes each
  source's single latest observation within a group, and averages only
  when two or more sources land in the same group. NBS and World Bank
  RTFP both report retail/household prices, so they average together;
  AFEX is an **exchange spot price** for a traded contract — a
  structurally different measurement — and is deliberately never
  averaged with the retail figures, even for the same commodity. The
  `CommodityPricesCard` on the public dashboard shows each source's own
  figure alongside the average, so the distinction stays visible rather
  than getting blended away.
- Both new domains are hidden behind their own `feature_flags` row
  (`production_conditions`, `commodity_prices`), both seeded `false` —
  flip them on in Supabase once you've verified a real ingest/entry flow
  in your own deployment (see Step 7 below).

## Roadmap (deliberately deferred, not in this build)

- **Automating AFEX spot pricing** — a deliberate decision, not a gap:
  AFEX has no official API or documented feed anywhere (see "Production
  conditions & commodity prices" above). Revisit if AFEX ever publishes
  one, or if a paid/registered-key third-party aggregator becomes worth
  the operational cost.
- **Scraping prices from online marketplaces (e.g. Jiji)** — explicitly
  ruled out. Manual data entry by a scoped `data_entry` account is the
  chosen path for anything that can't be machine-ingested, not scraping.
- **Multi-day streak detection** (e.g. "3 consecutive drying-risk days") —
  the risk-flag engine currently looks at one elapsed day at a time.
- **Public push channels** (Telegram, WhatsApp) — a real option if/when a
  public audience becomes the goal.

See [`SECURITY.md`](./SECURITY.md) for the threat model, hardening measures,
and the automated test suite that exercises them.

## Architecture

```
growthly-gic/
├── .github/workflows/
│   ├── nightly-ingest.yml                   # Exact 23:59 WAT weather cron trigger
│   ├── weekly-production-conditions-ingest.yml # Saturday 23:59 WAT FAOSTAT cron trigger
│   ├── weekly-commodity-prices-nbs-ingest.yml # Saturday 23:59 WAT NBS cron trigger
│   └── weekly-commodity-prices-worldbank-rtfp-ingest.yml
│                                             # Saturday 00:59 WAT World Bank RTFP cron trigger
├── supabase/
│   ├── schema.sql                           # weather_clusters, observed_hourly,
│   │                                         # daily_observed_reports — public read-only
│   └── migrations/
│       ├── 0001_full_day_ingest_cutoff.sql  # cutoff_hour_wat up to 23
│       ├── 0002_auth_roles_audit.sql        # user_roles, audit_log, feature_flags, RLS
│       ├── 0003_backfill_jobs.sql           # backfill_jobs — resumable job checkpoints
│       ├── 0004_production_conditions_and_manual_entries.sql
│       │                                     # production_conditions (FAOSTAT, public read-only)
│       │                                     # + manual_data_entries (generic, status-gated)
│       └── 0005_commodity_price_observations.sql
│                                             # commodity_price_observations (NBS + World Bank
│                                             # RTFP, public read-only) — AFEX stays on
│                                             # manual_data_entries, unchanged
├── scripts/
│   └── seed-super-admin.ts                  # One-time: create the first super_admin
├── src/
│   ├── proxy.ts                             # CSP nonce + session refresh + role gating
│   ├── middleware config: see proxy.ts's own `config.matcher`
│   ├── app/
│   │   ├── page.tsx, layout.tsx             # Public dashboard (weather + Sub-phase 2 cards)
│   │   ├── login/page.tsx                   # Email+password sign-in
│   │   ├── dashboard/page.tsx               # Post-login landing + manual-entry forms (data_entry)
│   │   ├── admin/page.tsx                   # Accounts + backfill + entry review (super_admin)
│   │   └── api/
│   │       ├── ingest/route.ts              # Nightly: Open-Meteo -> flags -> Gemini -> Supabase
│   │       ├── ingest/production-conditions/route.ts # Weekly: FAOSTAT -> Supabase
│   │       ├── ingest/commodity-prices-nbs/route.ts  # Weekly: NBS zip/xlsx -> Supabase
│   │       ├── ingest/commodity-prices-worldbank-rtfp/route.ts
│   │       │                                # Weekly: World Bank RTFP CSV -> Supabase
│   │       ├── chat/route.ts                # "Ask the analyst" Q&A endpoint
│   │       ├── export/route.ts              # Public CSV/XLSX telemetry export
│   │       ├── brief-card/[slug]/route.tsx  # Branded PNG briefing card (next/og)
│   │       ├── manual-entries/route.ts      # Submit (data_entry) / list (own or all)
│   │       ├── manual-entries/[id]/route.ts # Publish/reject a pending entry (super_admin)
│   │       └── admin/
│   │           ├── accounts/route.ts        # Invite/list data-entry accounts (super_admin)
│   │           ├── accounts/[userId]/route.ts # Activate/deactivate an account
│   │           └── backfill/route.ts        # Start/resume a historical-backfill job (any domain)
│   ├── components/                          # GicLogo, GicDashboard, AgentBriefPanel,
│   │                                         # LoginForm, SignOutButton, AdminAccountsPanel,
│   │                                         # BackfillPanel, ExportPanel,
│   │                                         # ProductionConditionsCard, CommodityPricesCard,
│   │                                         # CommodityPriceEntryForm, ManualEntryReviewPanel,
│   │                                         # DomainCardErrorBoundary
│   ├── hooks/use-analyst-chat.ts
│   └── lib/
│       ├── env.server.ts                    # Validated server-only env access
│       ├── ai-models.ts                     # Gemini fallback chain
│       ├── feature-flags.ts                 # Public feature_flags lookup (client-safe)
│       ├── paginate.ts, rate-limit.ts, timing-safe.ts, types.ts
│       ├── supabase/
│       │   ├── admin.ts                     # service_role client — bypasses RLS
│       │   ├── client.ts                    # anon-key, session-less — public reads
│       │   ├── server.ts                    # SSR, cookie-aware — Server Components/routes
│       │   └── browser.ts                   # SSR, cookie-aware — browser sign-in/out
│       ├── auth/
│       │   ├── cron-auth.ts                 # bearer-token check, shared by both ingest crons
│       │   ├── accounts-logic.ts            # Validation + the mass-assignment guard
│       │   └── audit.ts                     # Append-only audit_log writer
│       ├── domains/
│       │   ├── registry.ts                  # The fixed list of data-entry domains
│       │   ├── weather/
│       │   │   ├── ingest-logic.ts          # Steady-state nightly parsing + risk flags
│       │   │   ├── chat-logic.ts, export-logic.ts
│       │   │   └── backfill.ts              # Historical pull, reuses ingest-logic.ts
│       │   ├── production-conditions/
│       │   │   ├── ingest-logic.ts          # FAOSTAT parsing + defensive Area-code validation
│       │   │   └── backfill.ts              # Historical pull, enumerateYears() chunking
│       │   ├── commodity-prices/
│       │   │   ├── entry-schema.ts          # Zod payload shape for one manual (AFEX) entry
│       │   │   ├── price-types.ts           # Shared types + reconcileCommodityPrices() averaging
│       │   │   ├── nbs-ingest-logic.ts      # NBS xlsx/catalog parsing (pure)
│       │   │   ├── nbs-backfill.ts          # NBS zip download + extraction + Supabase write
│       │   │   ├── worldbank-rtfp-ingest-logic.ts # World Bank RTFP CSV/catalog parsing (pure)
│       │   │   └── worldbank-rtfp-backfill.ts     # World Bank RTFP CSV download + Supabase write
│       │   └── manual-entries/
│       │       ├── registry.ts              # domain -> payload-schema map
│       │       └── submission.ts            # Generic submission validation (any domain)
│       └── ingestion/
│           ├── backfill-framework.ts        # Generic resumable/rate-limited job runner
│           ├── backfill-request.ts          # Validation for starting a backfill job
│           └── domain-adapters.ts           # Registry: domain name -> fetch/write functions
└── tests/                                   # vitest — see SECURITY.md
```

## Step-by-step deployment guide

### Step 1 — Provision Supabase (Free tier)

1. Create a **new** Supabase project — do not reuse the AgroPulse NG
   pilot's project (pick the region closest to Nigeria, e.g. `eu-west-1` or
   `eu-central-1`).
2. Open **SQL Editor** and run, **in this exact order**, as three separate
   statements:
   1. [`supabase/schema.sql`](./supabase/schema.sql) — creates
      `weather_clusters`, `observed_hourly`, `daily_observed_reports`, public
      read-only RLS, and seeds the original 24 clusters (migration 0010
      below adds 5 more, for 29 total).
   2. [`supabase/migrations/0001_full_day_ingest_cutoff.sql`](./supabase/migrations/0001_full_day_ingest_cutoff.sql)
      — widens `cutoff_hour_wat` to allow up to 23.
   3. [`supabase/migrations/0002_auth_roles_audit.sql`](./supabase/migrations/0002_auth_roles_audit.sql)
      — adds `user_roles`, `audit_log`, `feature_flags`, and the
      `is_super_admin()` / `has_domain_scope()` RLS helper functions. This is
      what turns on the account system — nothing in "Accounts, roles &
      admin" below works until this runs.
   4. [`supabase/migrations/0003_backfill_jobs.sql`](./supabase/migrations/0003_backfill_jobs.sql)
      — adds `backfill_jobs`. Needed before using the historical-backfill
      panel.
   5. [`supabase/migrations/0004_production_conditions_and_manual_entries.sql`](./supabase/migrations/0004_production_conditions_and_manual_entries.sql)
      — adds `production_conditions` (FAOSTAT, public read-only) and the
      generic `manual_data_entries` table (AFEX's manual-entry use), plus
      their two `feature_flags` rows (seeded `false`). Needed before
      Step 7 below.
   6. [`supabase/migrations/0005_commodity_price_observations.sql`](./supabase/migrations/0005_commodity_price_observations.sql)
      — adds `commodity_price_observations` (NBS + World Bank RTFP, public
      read-only). AFEX stays on `manual_data_entries` from migration 0004 —
      no schema change needed for it. Needed before Step 7 below.
   7. [`supabase/migrations/0006_fewsnet_and_food_security.sql`](./supabase/migrations/0006_fewsnet_and_food_security.sql)
      — adds FEWS NET as a third `commodity_prices` source and a new
      `food_security` domain (HDX HAPI IPC/Cadre Harmonisé classification).
      Both feature-flagged off until reviewed.
   8. [`supabase/migrations/0007_production_conditions_stocks_and_slaughter.sql`](./supabase/migrations/0007_production_conditions_stocks_and_slaughter.sql)
      — widens `production_conditions.metric` to accept the two
      livestock-only FAOSTAT elements (`stocks`,
      `producing_animals_slaughtered`).
   9. [`supabase/migrations/0008_scenario_predictions.sql`](./supabase/migrations/0008_scenario_predictions.sql)
      — adds `scenario_predictions` and `prediction_outcomes`, the
      foundation for Sub-phase 6's Modelling/Adaptation/Intelligence
      scenario engine.
   10. [`supabase/migrations/0009_super_admin_domain_bypass.sql`](./supabase/migrations/0009_super_admin_domain_bypass.sql)
      — lets a `super_admin` pass `has_domain_scope()` checks directly, so
      they can submit manual entries themselves, not just assign the role
      to others.
   11. [`supabase/migrations/0010_add_weather_clusters_kaduna_sokoto_kogi_kwara_bayelsa.sql`](./supabase/migrations/0010_add_weather_clusters_kaduna_sokoto_kogi_kwara_bayelsa.sql)
      — adds 5 weather clusters (Kaduna, Sokoto, Kogi, Kwara, Bayelsa),
      bringing the total from 24 to 29. New clusters get nightly ingestion
      automatically; their historical weather still needs one manual
      backfill run each from the admin Backfill panel.
3. **Authentication → Providers**: confirm Email is enabled (it is by
   default). **Authentication → URL Configuration**: set the Site URL to
   your eventual production domain once you have it (Step 4).
4. Go to **Database → Replication** (or **Table Editor →
   daily_observed_reports → Enable Realtime**) so the dashboard updates live
   at 23:59 WAT without a page reload.
5. Copy three values from **Project Settings → API**:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**server secret —
     never expose this to the browser**)

### Step 2 — Obtain free Gemini and Groq API keys

1. Go to [Google AI Studio](https://aistudio.google.com) → **Get API Key** →
   **Create API key**.
2. Save it as `GOOGLE_GENERATIVE_AI_API_KEY` (free tier for the
   `gemini-3.5-flash-lite` / `gemini-3.1-flash-lite` models this app uses).
3. Go to [console.groq.com](https://console.groq.com) → **API Keys** →
   **Create API Key**.
4. Save it as `GROQ_API_KEY` (free tier for `openai/gpt-oss-120b`).

Every AI call in this app (`/api/ingest`'s nightly brief, `/api/chat`, and
`/api/production-conditions-brief`) goes through `withAiFallback()`
(`src/lib/ai-models.ts`), a three-leg fallback chain: both Gemini models
first, then Groq's `openai/gpt-oss-120b` last, only reached if both Gemini
legs fail with a retryable error (high demand, quota, timeout). Groq being a
different vendor on different infrastructure means a Google-side outage
can't take the whole chain down with it. Both keys are required — without
`GROQ_API_KEY`, the app still runs, but a Gemini outage has nowhere left to
fall back to.

### Step 3 — Local setup & push to a new GitHub repository

```bash
cp .env.example .env.local   # fill in the values from Steps 1-2, plus CRON_SECRET
openssl rand -hex 32         # generates a strong value for CRON_SECRET

npm install
npm run build                # sanity check before pushing
npm run test                 # runs the full test suite — see SECURITY.md
npm run lint

git init
git add .
git commit -m "Initial Growthly Intelligence Centre (GIC) deployment"
gh repo create growthly-gic --private --source=. --push
# or: create an empty repo on github.com and `git remote add origin ... && git push -u origin main`
```

Use a **new** GitHub repository, not the AgroPulse NG pilot's — this is a
deliberate decision to avoid any shared git history or infra coupling
between the two.

**Keep `.npmrc` committed.** It sets `legacy-peer-deps=true`, needed because
`vitest`'s peer dependency wants `@types/node@^22 || >=24` while the project
pins `@types/node@^20` (matching Next.js's own supported range). Without
`.npmrc`, a plain `npm install` — exactly what Vercel's build runs — fails
with an `ERESOLVE` error before the build ever starts.

### Step 4 — Deploy to Vercel (Free Hobby plan)

1. **Vercel Dashboard → Add New Project** → import your new `growthly-gic`
   repo (a **new** Vercel project — not the pilot's).
2. Under **Environment Variables**, add all six app secrets:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`,
   `GROQ_API_KEY`, `CRON_SECRET`.
   **Do not** add `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` here — those
   are read only by the one-time local seed script (Step 5), never by the
   deployed app.
3. Click **Deploy** and copy the production domain, e.g.
   `https://growthly-gic.vercel.app`.
4. Back in Supabase: **Authentication → URL Configuration** → set the Site
   URL to this production domain, so invite/password-reset emails link to
   the right place.

### Step 5 — Create the super admin account

Run this once, from your own machine, with the real `.env.local` in place
(never from a Vercel environment variable, and never reachable over the
web — see `SECURITY.md`):

```bash
SUPER_ADMIN_EMAIL=you@growthlysolutions.com \
SUPER_ADMIN_PASSWORD='choose-your-own-strong-password' \
npm run seed:super-admin
```

Sign in at `https://<your-domain>/login` with that email/password. You'll
land on `/admin`, where you can invite scoped `data_entry` accounts and
start a historical backfill.

### Step 6 — Activate the 23:59 WAT GitHub Actions cron

1. In the GitHub repo: **Settings → Secrets and variables → Actions → New
   repository secret**, and add:
   - `VERCEL_APP_URL` — your Vercel domain, **no trailing slash**
   - `CRON_SECRET` — the exact same value you set in Vercel
2. Go to the **Actions** tab → **Nightly 2359 WAT Observed Weather
   Ingestion** → **Run workflow** to populate today's telemetry immediately.
   From then on it runs automatically every night at 22:59 UTC (23:59 WAT).

### Step 7 — Activate production conditions & commodity prices (Sub-phase 2)

No new secrets needed — the new weekly crons all reuse the same
`VERCEL_APP_URL`/`CRON_SECRET` GitHub Actions secrets from Step 6.

1. Go to the **Actions** tab → **Weekly Saturday 2359 WAT Production
   Conditions Ingestion** → **Run workflow** to pull FAOSTAT's current
   figures immediately. From then on it runs automatically every Saturday
   at 22:59 UTC (23:59 WAT) — most runs will find nothing new, since
   FAOSTAT publishes annually, not weekly; that's expected, not a bug.
2. Do the same for **Weekly Commodity Prices NBS Ingestion** (Saturday
   22:59 UTC / 23:59 WAT) and **Weekly Commodity Prices World Bank RTFP
   Ingestion** (Saturday 23:59 UTC / 00:59 WAT, offset by an hour from the
   other two Saturday crons so they don't contend for the same Vercel
   Hobby invocation window).
3. On `/admin`, use the **Historical backfill** panel's domain selector to
   run `production_conditions`, `commodity_prices_nbs`, and
   `commodity_prices_worldbank_rtfp` backfills over as much past history
   as each source has — the same "Run until done" flow as weather, just
   chunked differently per domain: `production_conditions` in multi-year
   spans (FAOSTAT publishes annually), `commodity_prices_nbs` in
   multi-month spans against its monthly catalog, and
   `commodity_prices_worldbank_rtfp` with no date range at all — World
   Bank RTFP publishes Nigeria's entire 2007-to-present history in one
   CSV re-released under a new filename roughly weekly, so every backfill
   tick just re-fetches the current file (any date range you pick is
   accepted but ignored for that one domain).
4. **Before flipping either flag on, confirm each first live run actually
   wrote rows in the expected shape** — this build environment's own
   outbound network allowlist blocks direct access to
   `nigerianstat.gov.ng` and `worldbank.org` (confirmed by a direct `curl`
   test: `403` on the `CONNECT` tunnel), so none of the three new
   ingestors' exact live response shapes were verified from here. All
   three throw a loud, specific error instead of silently writing nothing
   if they get back an HTML login/terms wall instead of the expected ZIP,
   xlsx, or CSV — see `SECURITY.md` §16 (FAOSTAT) and the new §18/§19
   (NBS / World Bank RTFP) for what each one checks and what the error
   messages mean if you see them in Vercel's function logs on a real run.
5. Once verified, flip `production_conditions` and `commodity_prices` to
   `enabled = true` in Supabase's **Table Editor → feature_flags** (or via
   SQL) to make the public dashboard cards appear. `commodity_prices`
   covers all three sources (NBS, World Bank RTFP, and AFEX) under one
   flag and one dashboard card — there's no separate flag per source.
6. AFEX still has no automated ingest to run — it remains the one
   manual-entry source (see "What's in it" above). Invite a `data_entry`
   account scoped to `commodity_prices` (below), have them submit a few
   AFEX entries from `/dashboard`, review and publish them from `/admin`,
   and they'll show up on the dashboard card alongside the automated
   NBS/World Bank RTFP figures — averaged with each other, never with
   AFEX's exchange-spot price (see "What's in it" above for why).

## Accounts, roles & admin

There is no self-service sign-up. Two roles exist:

- **`super_admin`** — created only by `scripts/seed-super-admin.ts` (Step 5
  above), run directly against the service-role key on your own machine.
  There is no web UI path to creating a second super_admin; this is
  deliberate (see `SECURITY.md`'s mass-assignment section). A super admin
  can sign in at `/login` and manages everything from `/admin`: inviting
  `data_entry` accounts, activating/deactivating them, and running
  historical backfills.
- **`data_entry`** — created only by a super admin, from `/admin`, scoped to
  one or more data domains (`input_pricing`, `crop_pest_tracking`,
  `livestock_outbreak_tracking`, and — new in Sub-phase 2 —
  `commodity_prices`; see `src/lib/domains/registry.ts`). Inviting one
  sends a Supabase Auth invite email with a link to set a password; no
  password ever passes through this app's own server. A `data_entry`
  account signs in at `/login` and lands on `/dashboard`, which shows
  which domain(s) it's scoped to.

`commodity_prices` is the first domain with a real manual-entry form: a
`data_entry` account scoped to it sees a submission form on `/dashboard`
for AFEX observations specifically (NBS and World Bank RTFP are now
automated — see "What's in it" above — so the manual form only ever
needs to cover the one source with no API) and their own submission
history with each entry's review status (pending/published/rejected).
`input_pricing` and `crop_pest_tracking` still have no form yet — those
remain future sub-phase work; a staffer scoped only to those still sees
the "nothing to do yet" placeholder. Every submission lands `pending`; a
`super_admin` reviews it from `/admin`'s **Pending manual entries** panel
before it reaches the public dashboard — see `SECURITY.md` §17 for the
full authorization model.

Every account-management action (invite, activate, deactivate) writes a row
to the append-only `audit_log` table — see `SECURITY.md`.

## Historical backfill

Before GIC's own nightly telemetry has accumulated any real history,
`/admin`'s "Historical backfill" panel pulls in past data from an
upstream historical source, so the dashboard isn't starting from a blank
slate. Pick a **domain** — `weather`, `production_conditions`, or, new in
this rework, `commodity_prices_nbs` and `commodity_prices_worldbank_rtfp`
— and a past date range, then click **Run until done** — it fetches and
writes a chunk at a time, persisting progress after every chunk, so it's
safe to close the tab and come back later; clicking **Run until done**
again on the same range resumes exactly where it left off. `weather`
chunks in weeks (Open-Meteo's historical archive API);
`production_conditions` chunks in multi-year spans (FAOSTAT publishes
annually, not daily); `commodity_prices_nbs` chunks in multi-month spans
against NBS's monthly catalog; `commodity_prices_worldbank_rtfp` ignores
the date span entirely and always re-fetches the one current whole-history
CSV, since World Bank RTFP publishes no narrower request than that — the
panel's chunk size is picked for you either way, you only choose the
domain and date range. (AFEX has no historical source to backfill — it's
manual-entry only, see "Accounts, roles & admin" above.)

This is built as a generic framework (`src/lib/ingestion/`), not something
wired specifically to weather — `production_conditions`,
`commodity_prices_nbs`, and `commodity_prices_worldbank_rtfp` are all
proof that a new domain really does plug in without changing the
framework itself: each only needed a new `src/lib/ingestion/
domain-adapters.ts` registry entry and its own `fetchChunk`/`writeChunk`
pair reinterpreting the generic date-span chunking in whatever way fits
that source (`enumerateYears()` for FAOSTAT, "which catalog months fall
in this range" for NBS, and "ignore the range, there's only ever one
file" for World Bank RTFP — TypeScript's structural typing allows that
last one's zero-parameter `fetchChunk` to satisfy the framework's wider
`(start, end) => Promise<unknown>` interface unchanged). A future domain
with its own historical source does the same. See `SECURITY.md` for the
authorization and rate-limiting details.

## Resetting a domain's data

To empty one domain's ingested data and start fresh — say, weather looks
wrong after a bug fix, or you want to re-run FAOSTAT from a clean slate —
use `npm run reset-domain`, not a manual SQL `DELETE`. It's a standalone
script, run by hand from your own machine with `.env.local`'s
`SUPABASE_SERVICE_ROLE_KEY` (same posture as `seed:super-admin` — never an
API route, never reachable over the web), and it asks for a typed
confirmation before deleting anything:

```bash
npm run reset-domain -- --list                          # see every domain and what it touches
npm run reset-domain -- weather --dry-run                # just show row counts, delete nothing
npm run reset-domain -- weather                           # prompts: type "RESET weather" to confirm
npm run reset-domain -- production_conditions             # aliases work too: "fao", "faostat"
npm run reset-domain -- commodity_prices_nbs --yes         # skip the prompt (e.g. scripted use)
```

It clears the domain's own table(s) — `weather` empties
`observed_hourly`/`daily_observed_reports`, `production_conditions` empties
the FAOSTAT table, `commodity_prices_nbs`/`commodity_prices_worldbank_rtfp`/
`commodity_prices_fewsnet` each clear only their own source's rows out of
`commodity_price_observations` (or use the bare `commodity_prices` domain
to clear all three automated sources at once), `food_security` empties
`food_security_observations`, and `scenario_predictions` clears the AI
scenario tables. It also clears the matching `backfill_jobs` row(s), since
a job already marked "completed" makes the admin Backfill panel silently
no-op on the same date range afterwards — without that, re-running a
backfill after a reset would look like it worked but write nothing back.

It deliberately does **not** touch `weather_clusters` (cluster reference
data, not an observation), `user_roles`/`audit_log`/`feature_flags` (app
configuration), or manually entered records in `manual_data_entries` —
those are human-submitted and can't be "started fresh" by re-running a
cron. Pass `--include-manual-entries` on `production_conditions` or
`commodity_prices` only if you deliberately want those gone too; the
script prints a separate warning for them before you confirm.

After a reset, repopulate the domain from `/admin`'s Historical backfill
panel (or, for `production_conditions`, also
`npm run backfill:production-conditions-bulk` /
the matching GitHub Actions workflow).

## Troubleshooting

**Vercel build fails at `npm install` with `npm error code ERESOLVE` /
`Could not resolve dependency: peerOptional @types/node ... from
vitest@5.1.0`** — The repo's `.npmrc` (`legacy-peer-deps=true`) wasn't
pushed/committed. Confirm it exists at the repo root and is tracked by git
(`git ls-files .npmrc` should print `.npmrc`); if it's missing, add it back,
commit, and redeploy.

**`/api/ingest` returns 422 ("No elapsed observation hours to ingest yet for
this date")** — Normal if you run it in the first minute or two of a new WAT
calendar day and the Open-Meteo response for today hasn't propagated yet.
Re-run the workflow a few minutes later. If it happens at every hour of the
day, the Open-Meteo request window itself is wrong — see
`buildOpenMeteoUrl` in `src/lib/domains/weather/ingest-logic.ts`, which must
request `forecast_days=1` (not `0`).

**`/api/ingest` returns 500 ("Database write failed")** — The client-facing
message is deliberately generic; the real Postgres/Supabase error is in
Vercel's function logs. The two most common causes on a first deploy:
`supabase/schema.sql` was never fully run, or `SUPABASE_SERVICE_ROLE_KEY` in
Vercel is actually the anon/public key instead of the service-role key.

**Signing in at `/login` succeeds but `/admin` or `/dashboard` immediately
redirects back to `/login?error=no_access`** — The auth.users account
exists but has no row in `user_roles` (active). This happens if
`scripts/seed-super-admin.ts` was run before
`supabase/migrations/0002_auth_roles_audit.sql`, or if a data-entry invite's
role-assignment step failed after the auth user was created (the
`/api/admin/accounts` route cleans this up automatically by deleting the
orphaned auth user on that specific failure — but for the super-admin seed
script, re-run `npm run seed:super-admin`, which detects the existing auth
user and assigns the role without creating a duplicate).

**The nightly AI brief shows "the AI synthesis step did not complete," or
the in-app analyst chat says "temporarily unavailable"** — The ingestion and
dashboard data are unaffected (that's a deliberate graceful degradation),
but check Vercel's function logs for `[ingest] AI synthesis failed:` or
`[chat] AI generation failed:`. Google retires specific Gemini model IDs on
a published schedule
([ai.google.dev/gemini-api/docs/deprecations](https://ai.google.dev/gemini-api/docs/deprecations)).
If the log shows a 404 for the model, bump the model list in
`src/lib/ai-models.ts` (`GEMINI_FALLBACK_CHAIN`).

If instead the log shows a `TimeoutError`, that's Gemini taking longer than
the route's own abort budget to respond (free-tier latency varies). The
chat route gives it 40s against a 60s `maxDuration` (Vercel's Hobby-plan
ceiling); check your quota at
[aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit) if
it's a persistent pattern rather than a one-off.

**An hourly or daily export always comes back covering only the first day or
two of the requested range** — Supabase's API caps rows per request at 1000
regardless of how many rows match the filter. `src/lib/paginate.ts`'s
`fetchAllPages()` is what both export queries go through to loop past that
cap; `tests/paginate.test.ts` covers the page-boundary logic directly. If an
export still looks truncated, check first whether the underlying data simply
doesn't exist yet for the missing dates.

**`/api/ingest/commodity-prices-nbs` or `/api/ingest/commodity-prices-worldbank-rtfp`
returns 502 with an error mentioning "HTML" or "login/terms wall" instead
of the expected file format** — Both ingestors deliberately throw instead
of silently parsing garbage when the response isn't the ZIP (NBS) or CSV
(World Bank RTFP) they expect, because neither source's exact live
response shape could be confirmed from this build environment (its own
outbound network allowlist blocks `nigerianstat.gov.ng` and
`worldbank.org` directly — see `SECURITY.md` §18/§19). This means the
real-world catalog page is gating the download behind a login, a terms
click-through, or a changed URL structure that the regex-based link
finders in `nbs-ingest-logic.ts` / `worldbank-rtfp-ingest-logic.ts` no
longer match. Open the catalog URL in a browser
(`https://microdata.nigerianstat.gov.ng/index.php/catalog/162` or
`https://microdata.worldbank.org/index.php/catalog/4503`) from a real
network, see what's actually gating it, and adjust the matching
function accordingly.

**A historical-backfill job's status is stuck on "running" and progress
seems to have stopped** — "running" (not "completed" or "failed") just
means the last tick ran out of its ~45-second time budget before finishing
the whole range — this is expected for any range longer than a few weeks.
Click **Run until done** again (or wait — the admin panel's own "Run until
done" loop keeps re-ticking automatically while the tab is open) to continue
from the saved cursor. If it's genuinely stuck, check the job's `last_error`
(shown in the panel) — a non-null value means a chunk failed and the job
needs the underlying issue fixed (e.g. Open-Meteo rate-limiting) before
retrying.

## Local development

```bash
npm run dev     # http://localhost:3000
npm run build   # production build / type-check
npm run test    # vitest suite (see SECURITY.md)
npm run lint
```

To test the ingest route locally without waiting for the nightly cron:

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Brand

GIC is a Growthly Nexus Solutions Limited data product. The UI uses
Growthly's own brand palette — teal `#005a5a`, mint `#93e9be`, white, pale
mint `#d4f6e5`, and soft grey-green `#e0ebeb` — defined once as CSS custom
properties in `src/app/globals.css` and as Tailwind v4 theme tokens
(`bg-brand-teal`, `text-brand-ink`, etc.) throughout the components.
