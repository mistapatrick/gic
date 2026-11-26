/**
 * Runs the FAOSTAT production_conditions bulk backfill directly, outside
 * Vercel's request/response cycle.
 *
 * Why this exists: /api/ingest/production-conditions-bulk (route.ts) does
 * the exact same work, but is capped at maxDuration = 60 — a hard ceiling
 * on Vercel's free "Hobby" tier. FAOSTAT's bulk file is a whole-world,
 * whole-history export (every country, every year, one domain) —
 * meaningfully larger than any other single download this app handles —
 * and bulk-backfill.ts's own fetch-timeout comment already flagged that a
 * 45s download inside a 60s route might not be enough. It wasn't: a real
 * run timed out with 0 rows written. Raising the timeout doesn't fix an
 * inherently-too-large file for a serverless function regardless of how
 * long it's allowed to run — the actual fix is moving this one ingestion
 * off that cycle entirely, onto a runner with no such ceiling. This script
 * is that runner; weekly-production-conditions-bulk-ingest.yml invokes it
 * directly via GitHub Actions instead of calling the Vercel route.
 *
 * Reuses the SAME download/catalog-resolution/parsing logic as the Vercel
 * route (fetchProductionConditionsBulkChunk, parseProductionConditionsBulkChunk)
 * so there is exactly one implementation of "how to get this file and read
 * it" — only the final Supabase write is duplicated here (a few lines),
 * done with a minimal, standalone client rather than getSupabaseAdminClient()
 * (src/lib/supabase/admin.ts), which would otherwise pull in
 * getServerEnv()'s full env schema (AI keys, CRON_SECRET) — env vars this
 * ingestion has no use for and that this workflow has no reason to hold as
 * GitHub secrets.
 *
 * The route's own 60s-bounded invocation stays in place as a manual-trigger
 * fallback (e.g. a one-off re-run from the admin UI) — this script doesn't
 * replace it, both write into the same idempotent production_conditions
 * table (onConflict: "commodity,metric,year,region").
 *
 * Usage (mirrors scripts/seed-super-admin.ts's env-var convention):
 *   NEXT_PUBLIC_SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npm run backfill:production-conditions-bulk
 *
 * That npm script sets NODE_OPTIONS=--conditions=react-server — required so
 * Node resolves the "server-only" package (guarding backfill.ts, imported
 * transitively below) to its no-op build rather than its throwing one; only
 * Next.js's own webpack build sets that condition automatically. Don't run
 * this file with plain `tsx` directly, or that throw is what you'll see.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" }); // no-op in CI (no .env.local there) — for local manual runs

import { createClient } from "@supabase/supabase-js";
import {
  fetchProductionConditionsBulkChunk,
  parseProductionConditionsBulkChunk,
} from "../src/lib/domains/production-conditions/bulk-backfill";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    console.error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set " +
        "(as GitHub repo secrets in CI, or in .env.local for a manual local run)."
    );
    process.exit(1);
  }

  console.log("Resolving FAOSTAT's current bulk-download URL and fetching the file...");
  const csvRows = await fetchProductionConditionsBulkChunk();
  console.log(`Downloaded and parsed ${csvRows.length} raw CSV rows.`);

  const rows = parseProductionConditionsBulkChunk(csvRows);
  console.log(`${rows.length} rows matched Nigeria after filtering.`);

  if (rows.length === 0) {
    console.log("Nothing to write — exiting without touching production_conditions.");
    return;
  }

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  // Same conflict target as upsertProductionConditionRows() in
  // src/lib/domains/production-conditions/backfill.ts — every write path
  // into this table (live-query, bulk, and the manual-upload route) shares
  // this one idempotency key, so this script's writes are indistinguishable
  // from, and safely re-runnable alongside, any of the others.
  const { error } = await admin
    .from("production_conditions")
    .upsert(rows, { onConflict: "commodity,metric,year,region" });

  if (error) {
    console.error(`production_conditions upsert failed: ${error.message}`);
    process.exit(1);
  }

  console.log(`✅ Wrote ${rows.length} rows to production_conditions.`);
}

main().catch((err) => {
  console.error("Unexpected error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
