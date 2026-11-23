# Security notes

GIC now handles real user accounts (super admin + scoped data-entry
personnel) in addition to the public, account-less weather dashboard. The
trust boundaries this document covers: (1) a bearer secret from the nightly
GitHub Actions cron, (2) free-text messages typed into the "Ask the
analyst" chat drawer, (3) third-party responses from the Open-Meteo,
Gemini, and (as of Sub-phase 2) FAOSTAT, NBS, and World Bank RTFP APIs —
JSON, zipped xlsx, and CSV respectively, (4) date-range/format query
parameters on the public CSV/Excel export endpoint, (5) human sign-in and
session handling via Supabase Auth, (6) the account-management and
historical-backfill surfaces reachable only by a signed-in `super_admin`,
(7) every response this app sends to a browser, via security headers, and
(8) a `data_entry` account's own manual-entry submissions (Sub-phase 2;
now AFEX only — see §17), which are untrusted human input even though
they come from an authenticated, domain-scoped account. This document
states the threat model for each boundary, what was built to close it,
and which automated test proves the closure holds — not just that the
code "should" be safe by construction.

Run the full suite with `npm run test` (or `npx vitest run`). Current state:
**18 test files, 217 tests, all passing.**

`/api/brief-card/[slug]` (the branded PNG export used for bids and client
briefings) is intentionally public and unauthenticated: it reads the exact
same `daily_observed_reports` data the dashboard already serves, through
the same anon-key, RLS-public-read client (see §8 below and
`supabase/schema.sql`), so it carries no more exposure than the dashboard
page it's rendering a snapshot of. A malformed `date` query param or an
unknown cluster `slug` both resolve to a plain 404 JSON response rather than
a crash or a stack trace.

## 1. Authentication on `/api/ingest`

**Threat.** `/api/ingest` triggers a Supabase write and a billed-adjacent
Gemini call. If it were unauthenticated, or if the check were a naive
`===` string comparison, anyone could trigger it repeatedly (cost/abuse) or,
in principle, use response-timing differences to narrow down the secret
character-by-character. This is unrelated to the human-account auth system
in §10-13 below — `CRON_SECRET` authenticates GitHub Actions, not a person.

**Mitigation.**
- The route requires `Authorization: Bearer <CRON_SECRET>` and returns `401`
  otherwise (`src/app/api/ingest/route.ts`).
- The comparison itself (`src/lib/timing-safe.ts`) uses Node's
  `crypto.timingSafeEqual` on a length-checked buffer pair, not `===`, so a
  wrong guess takes the same time regardless of how many leading characters
  match.
- The comparison logic is factored into a pure, dependency-free function,
  `isAuthorizedBearer()` (`src/lib/auth/cron-auth.ts`), specifically so it
  can be unit tested without a live `NextRequest`.

**Proof.** `tests/cron-auth.test.ts` and `tests/timing-safe.test.ts` assert:
the correct secret passes, any wrong secret of the same length fails, a
missing/malformed header fails, and — critically — `timingSafeStringEqual`
is exercised with mismatched lengths and mismatched content to confirm it
never throws or short-circuits on the comparison itself.

## 2. Secret isolation

**Threat.** `SUPABASE_SERVICE_ROLE_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY`
grant full read/write and billed API access respectively. If either leaked
into a client bundle, any site visitor could extract it from the browser's
network tab or JS bundle.

**Mitigation.**
- `src/lib/env.server.ts`, `src/lib/supabase/admin.ts`, `src/lib/auth/audit.ts`,
  and the AI call sites all start with `import "server-only"` — a
  build-time guard that fails the Next.js build if any of those modules are
  ever imported into client-bundled code.
- The browser-facing Supabase clients (`src/lib/supabase/client.ts`, the
  public anon-key read client; `src/lib/supabase/browser.ts`, the
  cookie-based sign-in client — also anon key only) and the two
  server-only clients (`src/lib/supabase/admin.ts`, service role;
  `src/lib/supabase/server.ts`, cookie-aware, RLS-scoped as whichever human
  is signed in) are kept in separate files so a stray import can't quietly
  cross the boundary.
- `src/lib/env.server.ts` validates every secret through a strict Zod schema
  at startup, so a missing or malformed secret fails loudly in deployment
  logs instead of silently producing broken requests at 23:59 WAT.
- `scripts/seed-super-admin.ts` (the only place a `super_admin` account is
  ever created) reads `SUPABASE_SERVICE_ROLE_KEY` from `.env.local` and is
  run by hand on the operator's own machine — it is not a web route, so the
  service-role key it uses is never exposed over HTTP by this script. See
  §10 for why `/api/admin/accounts` (the web-reachable account route)
  cannot create a `super_admin` at all, regardless of key access.

**Proof.** This is a static, build-time property rather than a runtime
behavior, so it is enforced by `npm run build` itself (it would fail if
`server-only` were ever imported client-side) rather than by a vitest case;
`tests/stubs/server-only.ts` exists only to let these modules' *other* logic
run under plain Node for unit testing, and is wired in solely through
`vitest.config.mts`'s resolver alias, never shipped in the Next.js build.

## 3. SQL injection

**Threat.** Classic SQL injection requires building a query by string
concatenation. Every route in this codebase — weather ingestion/chat/export,
and the new accounts/audit/backfill routes alike — reads and writes
Supabase using the Supabase/PostgREST query builder (`.from(...).upsert(...)`,
`.select(...)`), never raw SQL strings — so there is no injection point by
construction. The schema (`supabase/schema.sql`,
`supabase/migrations/0002_auth_roles_audit.sql`,
`supabase/migrations/0003_backfill_jobs.sql`) also revokes
`insert`/`update`/`delete` from `anon` and `authenticated` roles on every
table as defense-in-depth, so even a compromised anon key or a stolen
user session JWT can only do what its RLS policies explicitly allow.

**Proof, not just assertion.** `tests/chat-logic.test.ts` feeds a
SQL-injection-shaped string (`'; DROP TABLE weather_clusters; --`) through
`ChatRequestSchema` and confirms it is accepted as ordinary message text — it
is validated as a bounded string, never parsed as or concatenated into a
query. `tests/xss.test.tsx` sends the same payload through the actual chat
UI and asserts it reaches `fetch` as a plain JSON string field
(`body.message === payload`), never interpolated into a URL, header, or
template string.

## 4. HTML injection / XSS

**Threat.** The AI-generated brief and the chat replies are both free text
that flows from an external API into the rendered page. If rendered via
`dangerouslySetInnerHTML` or a template-string `innerHTML` assignment, a
crafted response (or a prompt-injected one — see §6) could inject a live
`<script>`/`<img onerror>` element.

**Mitigation.** Every place AI or user text is displayed
(`src/components/AgentBriefPanel.tsx`) renders it as `{content}` — plain JSX
text interpolation, which React escapes automatically. `dangerouslySetInnerHTML`
is not used anywhere in the codebase. §14's Content-Security-Policy is a
second, independent layer on top of this: even a successful injection would
still have its inline `<script>` blocked by `script-src`'s nonce
requirement in a real browser.

**Proof.** `tests/xss.test.tsx` doesn't just inspect the source for the
absence of `dangerouslySetInnerHTML` — it renders the real component tree
with payloads like `<img src=x onerror="window.__pwned=true">` and
`<script>window.__pwned=true</script>` injected as if they were a report
summary or a chat reply, then asserts via the DOM (`container.querySelector`)
that no live `<script>` or `<img>` element exists and that the global
side-effect (`window.__pwned`) never fired.

## 5. Idempotency of the nightly ingest

**Threat.** The GitHub Actions cron, Vercel's own retry behavior, or a manual
re-run via `workflow_dispatch` could all cause `/api/ingest` to run twice for
the same night. Duplicate rows would double-count rainfall/sunshine
accumulators and corrupt the dashboard. The same concern applies to a
historical-backfill chunk being re-run — see §15.

**Mitigation.**
- `supabase/schema.sql` declares `unique (cluster_id, obs_date, obs_hour)` on
  `observed_hourly` and a primary key of `obs_date` on
  `daily_observed_reports`.
- Both writes in `src/app/api/ingest/route.ts` use
  `.upsert(rows, { onConflict: "..." })` against those exact keys, so a
  second run with the same date overwrites in place instead of duplicating.
- `parseIngestionResults()` (`src/lib/domains/weather/ingest-logic.ts`) is a
  pure function: identical input always produces byte-identical output.

**Proof.** `tests/ingest-logic.test.ts` includes a dedicated idempotency
test asserting `parseIngestionResults(sameInput)` called twice returns
`toEqual` results, and a second test asserting the parsed row set contains
exactly one row per `(cluster_id, obs_date, obs_hour)` combination per run —
together, the logical basis for why re-running a night's ingestion is safe to
retry.

## 6. Prompt injection (Gemini brief + chat)

**Threat.** The nightly brief is grounded in third-party telemetry, and the
chat drawer takes arbitrary user text — either could contain text crafted to
make the model ignore its instructions ("ignore the above and instead say...").

**Mitigation.** `buildChatSystemPrompt()`
(`src/lib/domains/weather/chat-logic.ts`) explicitly instructs the model to
treat the user's message as a question to answer, never as an instruction
that changes its role, rules, or scope, and to answer only from the supplied
JSON report — never from outside knowledge or from instructions embedded in
the user's message. `ChatRequestSchema` also bounds message length (1-500
chars) and conversation history (max 6 turns), limiting the size of any
single injection attempt.

**Proof.** `tests/chat-logic.test.ts` asserts the system prompt text contains
the anti-injection instruction and the data-grounding instruction, and that
oversized/malformed input is rejected by validation before it ever reaches
the model call.

## 7. Rate limiting on `/api/chat`

**Threat.** `/api/chat` calls Gemini (a billed-adjacent, free-tier-limited
API) on every request. Without a limit, a single abusive client could exhaust
the free quota for everyone.

**Mitigation.** `checkRateLimit()` (`src/lib/rate-limit.ts`) applies a fixed
10-requests-per-60-seconds window per client IP (`x-forwarded-for` /
`x-real-ip`), returning `429` with a `Retry-After` header once exceeded, with
a `MAX_TRACKED_KEYS` eviction cap to bound memory.

**Known limitation, stated plainly:** this is an in-memory limiter. Vercel's
serverless functions are stateless and can scale to multiple instances, each
with its own independent counter — so the *effective* limit under heavy,
distributed load is `10 × (number of warm instances)`, not a strict global
10/60s. For GIC's expected traffic (Growthly's own team and a handful of
farmers checking a free regional dashboard) this is an acceptable trade-off
for zero added infrastructure; a production system expecting abuse-grade
traffic should replace it with a shared store (e.g. Upstash Redis) without
changing the `checkRateLimit()` call site.

**Proof.** `tests/rate-limit.test.ts` uses `vi.useFakeTimers()` /
`vi.setSystemTime()` to deterministically prove: the 11th request within a
window is rejected, the window resets correctly after it elapses, and
different client keys are tracked independently.

## 8. Untrusted third-party responses

**Threat.** Open-Meteo and Gemini are external services. A malformed,
truncated, or unexpectedly-shaped response from either should not crash the
route or silently write garbage into Supabase.

**Mitigation.**
- `OpenMeteoResponseSchema` (Zod, `src/lib/domains/weather/ingest-logic.ts`)
  validates the upstream shape before any value is used; a mismatch returns
  `502` rather than writing partial/malformed rows. The same schema is
  reused, unchanged, by the historical-backfill fetcher
  (`src/lib/domains/weather/backfill.ts`) against Open-Meteo's archive
  endpoint.
- All derived numeric values pass through `round()`/`nonNegative()` clamping
  before being written.
- If the Gemini call fails or times out, the route degrades gracefully: it
  still saves the night's verified telemetry and writes a neutral placeholder
  summary rather than failing the whole ingestion because the AI narrative
  step failed.
- Every external call (Open-Meteo fetch, `generateObject`, `generateText`) is
  wrapped in `AbortSignal.timeout(...)` so an unreachable or hanging
  upstream can never hang the serverless function past Vercel's execution
  limit.

**Proof.** `tests/ingest-logic.test.ts` feeds malformed/incomplete Open-Meteo
fixtures through `OpenMeteoResponseSchema` and `parseIngestionResults` and
asserts the expected rejection or clamping behavior.
`tests/weather-backfill.test.ts` does the same for the backfill parser.

## 9. `/api/export` — public CSV/Excel telemetry export

**Threat.** `/api/export` is a public, unauthenticated GET endpoint that
accepts four query parameters (`type`, `format`, `start`, `end`) directly
from the URL and uses them to shape a Supabase query and build a downloadable
file. User-controlled date strings reach a DB query, and user-controlled
*output format* (CSV) is one where a cell value beginning with certain
characters is historically a live-exploit vector when the file is opened in
a spreadsheet program.

**Exposure rationale.** Public and unauthenticated is intentional, not an
oversight — it reads the exact same `observed_hourly` /
`daily_observed_reports` tables the dashboard already renders, through the
same anon-key, RLS-public-read client used by `/api/chat` and
`/api/brief-card` (see §8/§2 and `supabase/schema.sql`'s RLS comment). The
export changes *shape* (a file instead of a page), not the underlying
read-access boundary.

**Mitigations.**
- **Rate limiting.** `checkRateLimit()` applies a 10-requests-per-60-seconds
  window per client IP, namespaced separately from the chat limiter
  (`export:${clientKey}`), returning `429` + `Retry-After` once exceeded.
- **Input validation.** `ExportQuerySchema` (Zod,
  `src/lib/domains/weather/export-logic.ts`) restricts `type`/`format` to
  fixed enums and `start`/`end` to a strict `YYYY-MM-DD` shape before any
  date logic runs. `validateDateRange()` then rejects a start-after-end
  range and, critically, catches calendar-invalid dates that `new Date(...)`
  would otherwise silently roll forward (e.g. `"2026-02-30"` becomes
  `2026-03-02` with no error) by round-tripping the parsed date through
  `.toISOString().slice(0, 10)` and comparing it back to the original string.
- **Bounded query size.** `validateDateRange()` also caps the requested range
  at 92 days for hourly exports and 366 for daily exports.
- **Result-set pagination (bug fix, carried forward).** Supabase's PostgREST
  API caps rows per request (1000 by default) and trims the response
  silently rather than erroring. `src/lib/paginate.ts`'s `fetchAllPages()`
  loops via `.range()` until a short page confirms there's nothing left,
  over a fully deterministic `ORDER BY` so offset-based paging can't
  duplicate or skip rows across a page boundary.
- **CSV formula-injection defense-in-depth.** `sanitizeCsvCell()` prefixes
  any cell beginning with `=`, `+`, `-`, `@`, a tab, or a carriage return with
  a leading `'`. It does not apply to the XLSX path: `exceljs` writes each
  value into a typed cell, so a string is stored as text, never
  auto-interpreted as a formula on open.
- **Thin wrapper over pure logic.** The actual date/range/CSV/row-shaping
  logic lives in `src/lib/domains/weather/export-logic.ts` as
  dependency-free pure functions; `route.ts` only wires them to the
  request/response and the Supabase client.

**Dependency note: `exceljs` → transitive `uuid` advisory (reviewed,
accepted, re-confirmed in this repository).** `npm audit` flags a version of
`uuid` pulled in transitively by `exceljs` (GHSA-w5hq-g745-h8pq, "missing
buffer bounds check in v3/v5/v6 when a `buf` parameter is supplied"). The
suggested fix (`npm audit fix --force`) would downgrade `exceljs` four major
versions. The actual call site was checked: `exceljs` only calls
`uuid.v4()` with zero arguments (a conditional-formatting-extension rule-ID
feature this export doesn't use), never the vulnerable `buf`-parameter form
of `v3`/`v5`/`v6`. The vulnerable code path is structurally unreachable
through this app's usage, so the current `exceljs` version is kept and this
finding remains a reviewed, accepted risk. Re-run `npm audit` after any
future `exceljs` version bump and re-verify this reasoning still holds.

**Proof.** `tests/export-logic.test.ts` covers: `validateDateRange` (valid
ranges, inverted start/end, calendar-invalid dates, the 92/366-day caps);
`mapHourlyRows`; `flattenDailyReports`; `buildCsv` (header/row output,
escaping, the formula-injection prefix guard); and `buildExportFilename`.

## 10. Human authentication (Supabase Auth)

**Threat.** This is the first version of this codebase with real user
accounts at all. Getting session handling wrong — trusting a cookie's
claimed identity without revalidating it, or letting a session cookie go
stale without refresh — would let a forged or expired session pass as
authenticated, or log out legitimate users unpredictably.

**Mitigation.**
- Sign-in (`src/components/LoginForm.tsx`) uses
  `getSupabaseAuthBrowserClient()` (`src/lib/supabase/browser.ts`), built
  with `@supabase/ssr`'s `createBrowserClient`, which stores the session in
  cookies rather than `localStorage` specifically so the server (proxy,
  Server Components) sees the same session the browser does.
- `src/proxy.ts` (Next.js 16's "proxy" convention — the renamed successor
  to `middleware.ts`) runs on every request and, for the protected prefixes
  (`/admin`, `/dashboard`, `/api/admin`), calls
  `supabase.auth.getUser()` — **never** `getSession()` — specifically
  because `getUser()` revalidates the JWT against the Auth server on every
  call, while `getSession()` only reads the (possibly stale or forged)
  cookie locally. This is called out explicitly in a code comment in
  `src/proxy.ts` precisely so a future edit doesn't "simplify" it back to
  the weaker call.
- `src/proxy.ts` also refreshes the session cookie on every protected-path
  request (the standard `@supabase/ssr` Next.js pattern) — Server
  Components can't write cookies themselves, so without this a session
  nearing expiry would never get refreshed.
- `getCurrentUserRole()` (`src/lib/supabase/server.ts`) is the
  Server-Component/Route-Handler-side equivalent: it also calls
  `getUser()`, then joins against `user_roles` to resolve the caller's
  actual role, returning `null` for anyone with no active role row rather
  than defaulting to any particular access level.
- No password ever passes through this app's own server in either
  direction: `signInWithPassword` talks directly from the browser to
  Supabase Auth's API, and `inviteUserByEmail` (used when a super admin
  creates a `data_entry` account) only ever sends an invite link — the
  invited person sets their own password via Supabase Auth's own flow.

**Proof.** This is primarily an integration-level property (real Supabase
Auth, not something to fake in a unit test), so it's enforced by code
review and the explicit comments above rather than a vitest case. What *is*
unit-tested is everything downstream of "who is this request from" — see
§11-13.

## 11. Authorization: roles, RLS, and defense in depth

**Threat.** Even with correct authentication, a signed-in `data_entry`
account must not be able to read or write anything a `super_admin`-only
surface controls (account lists, the audit log, other accounts' role
assignments), and an inactive/deactivated account must lose access
immediately, not just stop appearing somewhere in a UI.

**Mitigation — layered, not single-point.**
- **Database layer (the authoritative one).**
  `supabase/migrations/0002_auth_roles_audit.sql` enables RLS on
  `user_roles`, `audit_log`, and `feature_flags`. `is_super_admin()` and
  `has_domain_scope()` are `SECURITY DEFINER` SQL functions — needed
  because a policy that checks "is this caller a super admin" by querying
  `user_roles` would otherwise be circular (you'd need read access to
  `user_roles` to find out whether you're allowed read access to
  `user_roles`). `anon`/`authenticated` have no insert/update/delete grant
  on any of these three tables at all — every write goes through
  `getSupabaseAdminClient()` (service role, bypasses RLS) from a route that
  has already checked the caller's role itself.
- **Proxy layer (defense in depth, not the source of truth).** `src/proxy.ts`
  redirects/403s before a request even reaches `/admin` or `/api/admin/*`
  if the caller isn't an active `super_admin` (or, for `/admin` ⁄
  `/dashboard` generally, isn't an active account at all). This exists so a
  disallowed request never executes any route-handler logic, but it is
  explicitly *not* trusted as the only check — see the next point.
- **Route-handler layer (re-checks, never trusts the proxy).** Every route
  under `src/app/api/admin/` calls `getCurrentUserRole()` itself and checks
  `role === "super_admin"` again, independently of whatever the proxy
  already decided. The comment in `src/app/api/admin/accounts/route.ts`
  states this explicitly: "a route handler should never be correct only
  because something upstream of it was correct." If a future refactor ever
  weakens or misconfigures the proxy's matcher, these routes are still
  safe on their own.
- **Deactivation, not deletion.** `PATCH /api/admin/accounts/[userId]`
  flips `active` rather than deleting the `auth.users` row, specifically so
  `audit_log` rows naming that user as `actor_id` are never orphaned by
  deleting the person they're about (the column is nullable for exactly
  this reason). A deactivated account's `active = false` row means
  `getCurrentUserRole()` returns `null` for them immediately on their next
  request — no caching layer holds a stale "still active" result.
- **Self-lockout guard.** The same route explicitly rejects a super admin
  trying to deactivate their *own* account via that endpoint.

**Proof.** The database-level RLS policies and `SECURITY DEFINER` functions
are integration-level (Postgres behavior, not unit-testable in isolation).
`tests/accounts-logic.test.ts` covers the validation layer in front of
them (§12). The redundancy between the proxy and each route handler is a
structural property verifiable by reading `src/proxy.ts` alongside
`src/app/api/admin/accounts/route.ts`,
`src/app/api/admin/accounts/[userId]/route.ts`, and
`src/app/api/admin/backfill/route.ts` — each independently calls
`getCurrentUserRole()` and checks the role.

## 12. Admin mass-assignment guard (account creation)

**Threat.** A classic privilege-escalation bug: a "create account" endpoint
that reads a `role` (or `is_admin`, `isAdmin`, etc.) field from the request
body and trusts it. If `/api/admin/accounts` did this, any caller who could
reach the endpoint at all could request `role: "super_admin"` for the
account they're creating and grant themselves (or a confederate) full
access.

**Mitigation.** `CreateDataEntryAccountSchema` (Zod,
`src/lib/auth/accounts-logic.ts`) has **no `role` field at all** — not a
restricted enum, not a default, simply absent from the schema. Zod strips
any extra field a caller sends (including `role`, `is_admin`, etc.)
silently; the route handler (`src/app/api/admin/accounts/route.ts`) never
reads a role out of the request body in the first place — it hardcodes
`role: "data_entry"` itself when inserting into `user_roles`. The *only*
way a `super_admin` account is ever created is `scripts/seed-super-admin.ts`,
run directly with the service-role key on the operator's own machine,
entirely outside the web app and its request/response cycle (see §2 and
§10). There is deliberately no API path to a second super admin at all —
a new one requires someone with direct Supabase service-role credential
access to run the script by hand, which is the actual intended control, not
an oversight to be "fixed" with a web form later.

**Proof.** `tests/accounts-logic.test.ts`'s dedicated test, "rejects an
attempt to smuggle a role field," passes a body containing
`role: "super_admin"` and `is_admin: true` alongside valid fields, and
asserts the parsed output has neither property — documenting the guarantee
at the validation layer the route actually depends on, rather than only
asserting it by code inspection.

## 13. Immutable audit log

**Threat.** Without a trustworthy record of who created, activated, or
deactivated which account, a dispute about "who did this" has no answer,
and a compromised super-admin session could cover its own tracks by editing
or deleting the log of what it did.

**Mitigation.** `audit_log` (`supabase/migrations/0002_auth_roles_audit.sql`)
has an RLS `select` policy for `super_admin` only, and **no update or
delete policy for any role at all, including super_admin** — an audit trail
you can edit isn't an audit trail. The only insert path is
`writeAuditLog()` (`src/lib/auth/audit.ts`), which uses the service-role
client specifically because `anon`/`authenticated` have no insert grant on
this table either — a compromised user session, however privileged its
role, cannot write to `audit_log` directly, only through a route that
constructs the entry itself. Every mutating admin action — account
creation (success *and* failure, including a validation rejection),
activation/deactivation, and each historical-backfill tick — calls
`writeAuditLog()` with the actor's ID, the action, and an outcome.
`writeAuditLog()` itself never throws: a failure to write the audit row is
logged to the server console but never allowed to block or crash the
action it was trying to record, which is the correct trade-off for a
secondary control (losing one audit line is bad; refusing to invite an
account because the audit insert had a transient failure would be worse).

**Proof.** The "no update/delete policy for anyone" guarantee is a
database-level property (verifiable by reading the migration: there is no
`for update` or `for delete` policy statement on `audit_log` at all, and
the `revoke` statement strips `insert`/`update`/`delete` from
`anon`/`authenticated`). The call sites are verifiable by reading each
mutating route in `src/app/api/admin/` — each one calls `writeAuditLog()`
on every outcome branch, not just the success path.

## 14. Security headers & Content-Security-Policy

**Threat.** Without CSP and the standard hardening headers, a successful
XSS injection (even one caught by §4's output-escaping in most cases) has
no second line of defense, the app can be framed by another site
(clickjacking), and browsers have no explicit signal to enforce HTTPS or
restrict unrelated capabilities (camera, geolocation) the app never uses.

**Mitigation.**
- **Static headers** (`next.config.ts`): `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive
  `Permissions-Policy`, and `Strict-Transport-Security` with
  `includeSubDomains; preload`.
- **Content-Security-Policy, with a fresh nonce on every request**
  (`src/proxy.ts`). This could not live in `next.config.ts`'s static
  `headers()` because a meaningful CSP needs a value that changes per
  request: `script-src 'self' 'nonce-<value>' 'strict-dynamic'`, with **no**
  `'unsafe-inline'`, is what actually stops an injected inline `<script>`
  from executing — the entire point of having a CSP at all. `'strict-dynamic'`
  is included because Next's own runtime chunk loader dynamically creates
  `<script>` elements for code-split chunks; without it, a script already
  trusted via the nonce couldn't load further Next-generated chunks and the
  app would break. `connect-src` allow-lists only `'self'` and the
  Supabase project's own host (https + wss, for the browser-side auth and
  public-read clients) — Open-Meteo and Gemini are never called from
  browser JS, only from server routes, so neither belongs in a *browser*
  CSP regardless of how the app reaches them server-side.
- **The nonce must be forwarded on the request, not just the response.**
  `src/proxy.ts` sets the same `Content-Security-Policy` header (nonce
  included) on both the outgoing response *and* the forwarded request
  headers. This is not redundant: Next's server-side renderer reads the
  nonce back out of the *request's* CSP header
  (`getScriptNonceFromHeaders()`, in Next's own source) to stamp it onto
  every inline `<script>` it generates server-side. Setting it only on the
  response would leave every Next-generated inline script nonce-less and
  therefore blocked by the very CSP meant to protect the page.
- **`style-src` keeps `'unsafe-inline'`, deliberately, unlike `script-src`.**
  A nonce can be attached to a `<style>` element, but CSP has no mechanism
  to nonce a plain element's `style=""` attribute — and the backfill
  progress bar (`src/components/BackfillPanel.tsx`) sets its width via a
  React inline `style` attribute. This is a narrower, well-understood
  trade-off (inline CSS cannot execute JavaScript) that was chosen
  deliberately rather than rewriting the progress bar to avoid it, and is
  not treated as equivalent to relaxing `script-src`.
  `src/app/layout.tsx` calls `headers()` in the root layout — not
  decoratively, but specifically because reading a dynamic API there is
  what makes every page render per-request instead of being statically
  prerendered at build time with no nonce context at all (Next's own
  documented fix for this exact failure mode). Removing that call without
  removing the nonce from `src/proxy.ts`'s CSP would silently break
  hydration on every page a build marks static.
- **The Supabase auth check only runs where it's needed.** `src/proxy.ts`
  sets the CSP header on *every* matched request, but only constructs a
  Supabase client and calls `getUser()` for the protected prefixes
  (`/admin`, `/dashboard`, `/api/admin`). This matters beyond performance:
  `/api/ingest` authenticates via `CRON_SECRET` (§1), has nothing to do
  with Supabase Auth, and must not acquire an extra network dependency (a
  call to Supabase Auth that could itself fail or time out) on its way to
  checking a bearer token.

**Proof.** Verified directly against a production build and a running
server (not just read from source): every response carries the CSP header;
the nonce value in the header matches, exactly, the `nonce="..."` attribute
on every inline `<script>` Next renders into the page (checked via `curl`
against `npm run build && npm run start`, comparing the header's nonce
token to each inline script's `nonce` attribute); two separate requests to
the same route produce two different nonces; and `/api/ingest`'s
unauthenticated-request latency confirms no Supabase round-trip happens on
that path. This is an infrastructure/integration property, so it's proven
by direct inspection of real HTTP responses rather than a unit test — a
unit test of `buildCsp()`'s string output would not catch the actual
failure mode here (a correct-looking CSP string that Next's renderer
doesn't apply correctly to its own inline scripts).

## 15. Historical backfill

**Threat.** The backfill framework (`src/lib/ingestion/`) runs under the
same super-admin-only gate as account management, but it's also the one
surface in this codebase that both calls a third-party API repeatedly
*and* writes a large, attacker-influenceable-shaped volume of data if
misused — a wide, carelessly-chosen date range could hammer Open-Meteo's
archive API or balloon Supabase writes.

**Mitigation.**
- **Authorization.** `POST`/`GET /api/admin/backfill` re-checks
  `getCurrentUserRole().role === "super_admin"` itself (§11's "never trust
  the proxy alone" pattern), on top of the proxy's own gate.
- **Bounded, validated input.** `validateStartBackfillInput()`
  (`src/lib/ingestion/backfill-request.ts`) restricts `domain` to the fixed
  set of registered adapters (`BACKFILL_DOMAINS` — `"weather"` and, as of
  Sub-phase 2, `"production_conditions"`; an unregistered domain name is
  rejected before any fetch happens), requires `rangeStart <= rangeEnd`,
  requires `rangeEnd` to be strictly in the past (backfill is for
  historical dates only — the steady-state `/api/ingest*` crons own
  anything from today), and clamps `chunkSizeDays` to 1-3650 (raised from
  1-31 in Sub-phase 2 specifically for `production_conditions`, an
  annual-granularity domain chunked in multi-year spans — still an
  explicit upper bound, not unlimited, so one chunk can't be asked to
  cover an unbounded range).
- **Resumable, time-boxed execution.** `runBackfillTick()`
  (`src/lib/ingestion/backfill-framework.ts`) processes chunks only until a
  ~45-second time budget is spent (comfortably inside Vercel's 60s
  `maxDuration` for this route, leaving margin for request/response
  overhead), persisting progress to `backfill_jobs` after *every single
  chunk* — not just at the end — so a timeout, crash, or redeploy mid-job
  loses at most one chunk's work, never the whole job. A failed chunk
  marks the job `"failed"` with the error recorded, rather than silently
  retrying forever or corrupting the cursor.
- **Idempotent writes, same pattern as steady-state ingestion (§5).**
  `writeWeatherBackfillChunk()` upserts `observed_hourly` on the same
  `(cluster_id, obs_date, obs_hour)` key, so re-running or overlapping a
  chunk is safe. `daily_observed_reports` uses
  `{ ignoreDuplicates: true }` specifically so a backfill can never
  overwrite an already-live, AI-authored report with its own placeholder
  summary for a date that's since been ingested normally.
  `src/lib/domains/weather/backfill.ts` also reuses
  `parseIngestionResults()` from the live steady-state path unchanged,
  rather than a re-derived parser that could drift from the tested one.
- **Rate-limited against the upstream API.** A configurable delay between
  chunks (`delayBetweenChunksMs`, default 1000ms server-side;
  `BackfillPanel.tsx`'s own "Run until done" loop adds a further 1500ms
  between its own ticks) means a multi-year backfill, which could mean
  dozens of chunk requests, doesn't fire them back-to-back against
  Open-Meteo's archive endpoint.
- **No AI cost per historical day.** Backfilled days deliberately skip the
  Gemini call that steady-state ingestion makes — see the comment on
  `BACKFILL_PLACEHOLDER_SUMMARY` in `src/lib/domains/weather/backfill.ts` —
  so a large historical pull can't exhaust the same free-tier Gemini quota
  the nightly cron and chat route depend on.

**Proof.** `tests/backfill-framework.test.ts` proves the generic runner
with fakes (no real Supabase, no real network): a job runs to completion
chunk-by-chunk; a job correctly stops mid-run once the time budget is
exhausted, leaving status `"running"` with progress preserved; a chunk
failure marks the job `"failed"` without losing already-written rows from
earlier chunks; and a job whose cursor is already past `rangeEnd` returns
`"completed"` immediately without calling fetch at all.
`tests/backfill-request.test.ts` covers every validation rule above,
including the unknown-domain and future-date rejections.
`tests/weather-backfill.test.ts` covers the weather-specific adapter:
correct date enumeration, the archive (not forecast) endpoint being used,
one daily report + 24 hourly rows produced per day in a chunk, and a date
with no returned data being skipped rather than written as an empty report.

## 16. Untrusted FAOSTAT responses + the unconfirmed-area-code risk

**Threat.** `production_conditions` (Sub-phase 2) ingests from FAOSTAT, a
third-party public API, the same class of risk as §8 (Open-Meteo/Gemini).
A FAOSTAT-specific second risk sits on top of that: Nigeria's exact
FAOSTAT legacy area code could not be independently confirmed against a
live API response from this build environment (the verification request
was blocked by FAOSTAT's own robots restrictions). Trusting an unconfirmed
numeric code silently would risk mis-filing another country's production
data as Nigeria's — a wrong-but-plausible-looking dataset is worse than an
obviously broken one, because nothing would visibly fail.

**Mitigation.**
- `FaostatResponseSchema`/`FaostatRecordSchema` (Zod,
  `src/lib/domains/production-conditions/ingest-logic.ts`) validate the
  upstream shape before any value is used, same pattern as
  `OpenMeteoResponseSchema` in §8.
- `FAOSTAT_AREA_CODE_NIGERIA` is documented in code as "best candidate,
  confirm on first live run," never as verified.
- `parseFaostatRecords()` defensively checks every returned record's own
  human-readable `Area` field actually equals "Nigeria" — not just trusting
  that the `area` query parameter did what it was expected to. A mismatch
  **throws**, failing the ingest run loudly (a `500` from the route, a
  `"failed"` backfill job with the error recorded) rather than silently
  writing wrong data. An empty result set (a year not yet released) is
  explicitly *not* treated as an error.
- Item and element codes are sidestepped entirely rather than guessed:
  `buildFaostatUrl()` omits `item`/`element` query parameters and fetches
  everything FAOSTAT returns for Nigeria in the requested years, then
  `matchCommodity()`/`matchMetric()` filter by the response's own
  human-readable name strings against `TRACKED_COMMODITIES`/
  `ELEMENT_METRIC_RULES` — removing a second unconfirmed-numeric-code risk
  the same way, rather than trading it for a third one.

**Proof.** `tests/production-conditions-ingest-logic.test.ts` covers: a
valid Nigeria record parses correctly; a record whose `Area` is anything
other than "Nigeria" throws; an empty response returns `[]` without
throwing; a record naming an untracked item or element is silently
skipped, not written; a `null` (not-yet-published) `Value` is skipped; and
a malformed response shape throws via the Zod schema.

## 17. Manual-entry review gate (AFEX commodity prices and future domains)

**Threat.** Sub-phase 2 scoped `commodity_prices` to automate all three
originally-named sources (AFEX, World Bank RTFP, NBS); researching each
source's real-world access, twice, found that NBS and World Bank RTFP are
genuinely automatable (now covered by §18/§19 below) but AFEX has no
official API or documented feed anywhere — only undocumented internal
endpoints or third-party aggregators (see
`claude/gic-phase-1-build-plan.md`). AFEX therefore stays on the
manual-entry design: a human `data_entry` account typing figures into a
form. This introduces a threat `production_conditions`/weather/NBS/World
Bank RTFP don't have: the figures themselves are untrusted **human**
input, not a validated third-party API response, and a compromised or
careless data-entry session must not be able to publish unreviewed
numbers directly to the public dashboard, submit on another account's
behalf, or write into a domain it isn't scoped to.

**Mitigation — layered, same philosophy as §11.**
- **Payload validation per domain.** `manual_data_entries.payload` is an
  untyped `jsonb` column by design (`supabase/migrations/
  0004_production_conditions_and_manual_entries.sql`); every domain's
  actual shape is enforced by Zod *before* insert
  (`CommodityPriceEntryPayloadSchema`,
  `src/lib/domains/commodity-prices/entry-schema.ts`, via
  `validateManualEntrySubmission()` in
  `src/lib/domains/manual-entries/submission.ts`) — a malformed or
  negative-price submission never reaches the database at all.
- **Database layer (the authoritative one).** The insert RLS policy's
  `with check` requires all three of: `status = 'pending'`,
  `entered_by = auth.uid()`, and `has_domain_scope(domain)` — so even a
  modified client request cannot submit a pre-published entry, submit as
  someone else, or write into an unscoped domain, regardless of what the
  route handler intended to insert. Only `is_super_admin()` may `update` a
  row (the publish/reject action); there is no delete policy for anyone,
  matching `audit_log`/`backfill_jobs` (§13) — a rejected entry stays a
  visible, append-only rejected row, never erased.
- **Route-handler layer (re-checks, never trusts RLS alone).**
  `POST /api/manual-entries` independently checks `role.role ===
  "data_entry"` and `role.domainScope.includes(domain)` before ever
  issuing the insert — the same "defense in depth, not a replacement" note
  from §11 applied here. `src/proxy.ts`'s `PROTECTED_API_PREFIXES` was
  extended to include `/api/manual-entries`, so an unauthenticated or
  deactivated caller never reaches this route's own checks at all — but
  unlike `/api/admin`, it is *not* restricted to `super_admin` only at the
  proxy layer, since both roles legitimately use it (submit vs. review).
- **Publication gate.** The public dashboard card
  (`src/components/CommodityPricesCard.tsx`) and the public anon-key RLS
  policy both only ever expose `status = 'published'` rows — a `pending`
  or `rejected` entry is visible only to its own submitter and to
  `super_admin` (two further, separately-named `select` policies on the
  same table), never to an anonymous visitor, until a `super_admin`
  explicitly reviews it via `PATCH /api/manual-entries/[id]`.
- **Re-review guard.** The review route's update query is scoped with
  `.eq("status", "pending")`, so reviewing an already-reviewed entry a
  second time (a double-click, a stale UI) returns a clean `404` rather
  than silently overwriting a prior `reviewed_by`/`reviewed_at`.
- **Audit logging.** Both submission and review call `writeAuditLog()` on
  every outcome branch, same as every other mutating admin/account action
  in this codebase (§13).
- **No separate idempotency/uniqueness constraint on submissions, by
  design.** Unlike `production_conditions`/`observed_hourly` (§5, §15),
  two submissions with identical commodity/market/price/date are not
  deduplicated at the database layer — a second data-entry account
  independently reporting the same observed price is legitimate
  corroborating data for a reviewer to reconcile, not an erroneous retry
  to silently merge.

**Proof.** `tests/manual-entries-submission.test.ts` covers the pure
validation layer: a valid submission is accepted with schema defaults
applied (`market`, `currency`); an unregistered domain name is rejected;
a known domain with no manual-entry schema yet (e.g. `input_pricing`) is
rejected with a clear "no manual-entry form built yet" message rather than
accepting an unvalidated payload; a non-positive price, a missing
commodity, an unknown `source` enum value, and a malformed date are each
rejected. The RLS policies themselves (insert `with check`, the three
`select` policies, the `super_admin`-only `update`) are a database-level
property verified by reading migration 0004 alongside the route handlers
in `src/app/api/manual-entries/`.

## 18. Untrusted NBS responses + the unconfirmed-response-shape risk

**Threat.** `commodity_prices_nbs` (this rework) ingests NBS's Selected
Food Price Watch — a monthly ZIP, downloaded from a public catalog page,
containing an xlsx workbook — the same class of risk as §8/§16, but with
two added wrinkles specific to this source. First, this build
environment's own outbound network allowlist blocks direct access to
`nigerianstat.gov.ng` (confirmed via a direct `curl` test: `403` on the
`CONNECT` tunnel), so the exact live shape of the catalog page and the
ZIP/xlsx it links to could not be confirmed from here — only from
research snippets and a sibling catalog's own structure. Second, unzipping
and parsing an untrusted file is a materially larger attack surface than
parsing JSON: a malicious or malformed ZIP can be built to exhaust memory,
overwrite arbitrary paths via a crafted entry name, or exploit a parser
bug, and NBS's monthly item labels have no fixed schema to validate
against — they're free-text strings that must be matched, not trusted.

**Mitigation.**
- **HTML-wall detection before any unzip attempt.**
  `extractXlsxRowsFromZip()` (`src/lib/domains/commodity-prices/
  nbs-backfill.ts`) sniffs the response body for HTML markers before ever
  calling `new AdmZip(zipBuffer)`, and throws a specific, actionable error
  (naming the catalog URL and what was received instead) rather than
  letting a ZIP-parsing library choke on an HTML login/terms page and
  produce a confusing low-level stack trace. Same pattern for
  `fetchCsvText()` in §19.
- **Conservative, evidence-only item matching — never a guessed mapping.**
  `NBS_ITEM_VARIANTS` (`src/lib/domains/commodity-prices/
  nbs-ingest-logic.ts`) only lists the four of fifteen tracked commodities
  (Rice (paddy), Yams, Cowpeas, Cattle meat) with an actual confirmed
  label variant from research. The other eleven simply produce no NBS
  observation rather than a wrong one guessed from a plausible-looking
  label — a visible gap in the reconciled output (§20) is always
  preferred over a silent mismatch.
- **Defensive header-row and period parsing.** `findNbsHeaderRow()` scans
  only the first five rows and requires at least two month-parseable
  cells before accepting a row as the header, rather than assuming a
  fixed row index that a format change could silently misalign.
  `parseNbsHeaderPeriod()` requires an exact `month[-]year` shape via
  regex and returns `null` (skipping that column) rather than guessing on
  anything looser.
- **Dependency audit: `adm-zip`.** `npm audit` flagged the
  auto-resolved `adm-zip@^0.5.18` with multiple HIGH/moderate CVEs
  relevant to exactly this use (unbounded-memory decompression, a
  symlink-following arbitrary-file-overwrite on extraction, a
  decompression-bomb check bypass, and others). Pinned to `^0.6.1`, which
  patches all of them; re-confirmed clean via `npm audit` after pinning.
  Re-run `npm audit` after any future `adm-zip` bump.

**Proof.** `tests/nbs-ingest-logic.test.ts` covers: `matchNbsItem`
(matches known variants, rejects unknowns); `parseNbsHeaderPeriod` and
`findNbsHeaderRow` (valid headers, no-header-found case); `parseNbsWorksheetRows`
(dated-column emission, fallback-period behavior, skips non-numeric/
non-positive cells, handles an empty sheet); `findAllNbsCatalogEntries`/
`findLatestNbsCatalogEntry` (link extraction, picks the highest catalog
id, null-handling on no match).

## 19. Untrusted World Bank RTFP responses + the unconfirmed-response-shape risk

**Threat.** `commodity_prices_worldbank_rtfp` (this rework) ingests the
World Bank's Real-Time Food Prices dataset for Nigeria — a CSV covering
73 markets' worth of price estimates, re-released under a new dated
filename on a public microdata catalog roughly weekly. Same first wrinkle
as §18: this build environment's outbound allowlist also blocks
`worldbank.org` directly (confirmed the same way), so the live catalog
and CSV shape are unconfirmed from here. A second, CSV-specific risk:
matching tracked commodities to arbitrary column names by substring is an
easy place to introduce a silent false match — which is exactly what
happened during this build's own testing (see below) — and a parser
option (`columns: true`) that turns header cells into object keys carries
its own, separately-patched CVE.

**Mitigation.**
- **HTML-wall detection before CSV parsing.** `fetchCsvText()`
  (`src/lib/domains/commodity-prices/worldbank-rtfp-backfill.ts`) checks
  both the response `content-type` and a body-sniff for HTML before
  handing anything to `csv-parse`, throwing a specific error naming the
  catalog URL rather than parsing an HTML page as if it were data.
- **Word-boundary-aware column matching — caught by this build's own test
  suite, not assumed correct.** `matchWorldBankColumn()`
  (`src/lib/domains/commodity-prices/worldbank-rtfp-ingest-logic.ts`)
  originally matched a tracked commodity by plain substring
  (`columnName.includes("rice")`), which silently matched the unrelated
  column `c_food_price_index` as "Rice (paddy)" — the word "price"
  contains the substring "rice". `tests/worldbank-rtfp-ingest-logic.test.ts`
  caught this before it ever reached a real run. The fix splits the
  column name into underscore-delimited segments and requires an *exact*
  segment match, not a substring — a real but accepted trade-off, since a
  commodity name written as one word with no delimiter (e.g. a
  hypothetical `soybean` instead of `soy_bean`) would now be missed
  rather than matched, which is a visible, safe gap (no data point from
  that source) rather than a silently wrong one. The same audit also
  found and fixed a second, structurally identical risk already latent
  in the variant list itself: `Cowpeas`'s matcher originally included a
  bare `"bean"`, which — once exact-segment matching was in place — would
  still have matched a `Cocoa beans` column (`c_cocoa_bean`) ahead of
  `Cocoa beans`'s own `"cocoa"` entry, since `Cowpeas` is checked earlier
  in the list. `Cowpeas` now matches only `"cowpea"`/`"cowpeas"`.
- **Market-to-national aggregation happens inside this source's own
  parser, before cross-source reconciliation ever runs.**
  `parseWorldBankRtfpRecords()` averages each commodity's price across
  all 73 Nigerian markets within a period first, producing one 'National'
  figure per commodity per period — consistent with the 'National' region
  convention `production_conditions` already uses — rather than letting
  73 market-level rows reach `reconcileCommodityPrices()` (§20) and skew
  an average meant to compare one agency's figure against another's.
- **No narrower request is possible, so none is attempted.**
  `fetchWorldBankRtfpBackfillChunk()` takes no date parameters at all —
  it always fetches the one current whole-history CSV, since World Bank
  RTFP publishes no date-ranged endpoint. This is a deliberate
  simplification, not an oversight: a narrower-looking request that
  silently returned the same whole file regardless would be worse than a
  function signature that's honest about what it does.
- **Dependency audit: `csv-parse`.** `npm audit` flagged the
  auto-resolved `csv-parse@^5.6.0` with a "prototype replacement still
  reachable via the `columns` path" advisory — directly relevant, since
  `columns: true` is exactly the option used here. Pinned to `^7.0.2`,
  which patches it; re-confirmed clean via `npm audit` after pinning.

**Proof.** `tests/worldbank-rtfp-ingest-logic.test.ts` covers:
`matchWorldBankColumn` (matches a tracked commodity, returns `null` for
an untracked one, and specifically returns `null` for
`c_food_price_index` rather than false-matching "Rice (paddy)" — the
regression test for the bug described above); `parseWorldBankRtfpRecords`
(market averaging, Nigeria-row filtering); `findLatestWorldBankCsvLink`
(link extraction).

## 20. Cross-agency price reconciliation integrity

**Threat.** This rework's central new capability —
`reconcileCommodityPrices()` averaging NBS, World Bank RTFP, and AFEX
figures for the same commodity — is also its main new correctness risk,
and it's a credibility risk for Growthly's own data product, not just a
code bug: AFEX publishes an **exchange spot price** for a traded futures
contract, while NBS and World Bank RTFP both publish **retail/household**
prices. These are structurally different measurements of different
things. Averaging them without checking would produce a single number
that reads as an authoritative cross-checked "market price" but isn't a
real price of anything — and unlike a visibly broken feature, a
confidently-wrong average looks *more* trustworthy than showing the raw,
unreconciled per-source figures, which makes this exactly the kind of
mistake worth guarding against deliberately rather than catching by luck.
The same risk applies, one level down, to blending figures recorded in
different units or currencies.

**Mitigation.**
- **Grouping key derived from the source, not from anything a payload
  controls.** `priceTypeForSource()`
  (`src/lib/domains/commodity-prices/price-types.ts`) hardcodes
  `AFEX → "exchange_spot"` and `NBS`/`NBS_HFP`/`WORLD_BANK_RTFP →
  "retail"`; `reconcileCommodityPrices()` then groups strictly by
  `(commodity, priceType, unit, currency, region)` before any averaging
  happens, so a retail figure and an exchange-spot figure for the same
  commodity are never in the same group no matter what a future payload
  or a data-entry typo supplies.
- **"Latest observation per source within a group," not "every
  observation."** NBS (monthly), World Bank RTFP (weekly-ish whole-history
  re-release), and AFEX (ad hoc manual entry) update on incompatible
  cadences and will rarely share an exact `period_date`.
  `reconcileCommodityPrices()` takes each source's single most recent
  observation within a compatibility group, rather than requiring exact
  date alignment (which would mean almost nothing ever reconciles) or
  averaging a source's whole history into one group (which would quietly
  weight a source with more observations more heavily).
- **No silent single-source "average."** An `average` is computed only
  when two or more sources land in the same group; with only one, it's
  left `null` rather than presenting an unreconciled single figure as if
  it had been cross-checked. `CommodityPricesCard.tsx` only renders the
  average when it's non-null, and always shows each source's own figure
  alongside it, so the distinction between "two agencies agree" and "one
  agency reported this" stays visible to anyone reading the dashboard.

**Proof.** `tests/commodity-price-reconcile.test.ts` covers:
`priceTypeForSource` (correct mapping per source, including the `OTHER`
default); `normalizeManualCommodityEntry` (AFEX manual-entry payloads map
to the normalized shape correctly); and `reconcileCommodityPrices`:
averages two retail sources; **never** averages a retail source with
AFEX's exchange-spot source for the same commodity; leaves `average`
`null` with only one source present; keeps only the most recent
observation per source within a group; never groups observations
recorded in different units together; returns results sorted by
commodity name.

## What is out of scope

- **DDoS / network-layer abuse** — left to Vercel's platform-level
  protections; not something an application-layer change here can address.
- **Supabase/Gemini/Open-Meteo's own security** — treated as trusted
  third-party infrastructure; this document covers only how GIC uses them.
- **Formal penetration testing** — the above is a focused review against
  the specific risks this application's data flows and account system
  introduce, proven with automated tests and direct HTTP-response
  inspection where a unit test can't reach the real failure mode (§14), not
  a general-purpose security audit.
- **Email deliverability for Supabase Auth invites/password-reset.** This
  app relies on Supabase's own email sending (default shared SMTP on the
  free tier, rate-limited). If invite emails aren't arriving reliably in
  production, that's a Supabase project configuration matter (a custom SMTP
  provider), not an application-code fix.
