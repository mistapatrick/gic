/**
 * Empty one domain's ingested data and start fresh — weather, FAO
 * (production_conditions), NBS/World Bank RTFP/FEWS NET (commodity
 * prices), food security, or AI scenario predictions.
 *
 * Deliberately NOT an API route or anything reachable over the web — same
 * posture as seed-super-admin.ts and run-production-conditions-bulk-backfill.ts,
 * but more so: this is a destructive, irreversible bulk delete, so it only
 * ever runs by hand, from your own machine, with .env.local's
 * SUPABASE_SERVICE_ROLE_KEY, with an explicit typed confirmation before
 * anything is deleted. See src/lib/ingestion/domain-reset-registry.ts for
 * exactly which tables each domain touches and what it deliberately leaves
 * alone (weather_clusters, user_roles/audit_log/feature_flags, and
 * manual_data_entries unless you opt in with --include-manual-entries).
 *
 * It also clears the matching backfill_jobs row(s), because a job marked
 * "completed" makes the admin Backfill panel silently no-op on the same
 * date range afterwards — see the registry file's header comment.
 *
 * Usage:
 *   npm run reset-domain -- --list
 *   npm run reset-domain -- weather --dry-run
 *   npm run reset-domain -- weather
 *   npm run reset-domain -- production_conditions --include-manual-entries
 *   npm run reset-domain -- commodity_prices_nbs --yes
 *
 * After a reset, re-run that domain's backfill from the admin Backfill
 * panel (or, for production_conditions_bulk, the GitHub Actions workflow)
 * to repopulate it — this script only empties the domain, it never
 * re-ingests.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" }); // no-op in CI (no .env.local there) — for local manual runs

import * as readline from "node:readline/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DOMAIN_RESET_REGISTRY,
  resolveDomainKey,
  describeDomainsForHelp,
  type DomainResetFilter,
} from "../src/lib/ingestion/domain-reset-registry";

interface ParsedArgs {
  domainInput?: string;
  dryRun: boolean;
  yes: boolean;
  includeManual: boolean;
  list: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positionals = argv.filter((a) => !a.startsWith("--"));
  return {
    domainInput: positionals[0],
    dryRun: flags.has("--dry-run"),
    yes: flags.has("--yes"),
    includeManual: flags.has("--include-manual-entries"),
    list: flags.has("--list") || argv.includes("-l"),
    help: flags.has("--help") || argv.includes("-h"),
  };
}

async function countRows(
  admin: SupabaseClient,
  table: string,
  filter?: DomainResetFilter
): Promise<number> {
  let query = admin.from(table).select("*", { count: "exact", head: true });
  if (filter) query = query.eq(filter.column, filter.value);
  const { count, error } = await query;
  if (error) throw new Error(`Counting ${table}: ${error.message}`);
  return count ?? 0;
}

async function deleteRows(
  admin: SupabaseClient,
  table: string,
  filter?: DomainResetFilter
): Promise<number> {
  // ".gt('id', 0)" is the "match every row" idiom: every table this script
  // touches has a bigint-identity primary key starting at 1, and
  // supabase-js requires an explicit filter on delete() — there is no
  // bare "delete everything" call.
  let query = admin.from(table).delete({ count: "exact" }).gt("id", 0);
  if (filter) query = query.eq(filter.column, filter.value);
  const { count, error } = await query;
  if (error) throw new Error(`Deleting from ${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.list || !args.domainInput) {
    console.log(describeDomainsForHelp());
    return;
  }

  const canonicalKey = resolveDomainKey(args.domainInput);
  if (!canonicalKey) {
    console.error(`Unknown domain "${args.domainInput}".\n`);
    console.log(describeDomainsForHelp());
    process.exit(1);
  }
  const spec = DOMAIN_RESET_REGISTRY[canonicalKey!];

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local."
    );
    process.exit(1);
  }
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  const targets = [...spec.targets];
  if (args.includeManual && spec.manualEntryDomain) {
    targets.push({
      table: "manual_data_entries",
      filter: { column: "domain", value: spec.manualEntryDomain },
    });
  } else if (args.includeManual && !spec.manualEntryDomain) {
    console.warn(
      `"${canonicalKey}" has no manual-entry counterpart — --include-manual-entries ignored.`
    );
  }

  console.log(`\nDomain reset: ${spec.label} (${canonicalKey})\n`);
  console.log("This will permanently delete:");

  let anyDataRows = false;
  for (const t of targets) {
    const n = await countRows(admin, t.table, t.filter);
    anyDataRows = anyDataRows || n > 0;
    const isManual = t.table === "manual_data_entries";
    const filterNote = t.filter ? ` (${t.filter.column} = ${t.filter.value})` : "";
    const warningNote = isManual ? "  ⚠ human-submitted — not recoverable by re-ingesting" : "";
    console.log(`  - ${n.toLocaleString()} row(s) from ${t.table}${filterNote}${warningNote}`);
  }

  let jobRows = 0;
  for (const domain of spec.backfillJobDomains) {
    jobRows += await countRows(admin, "backfill_jobs", { column: "domain", value: domain });
  }
  if (spec.backfillJobDomains.length > 0) {
    console.log(
      `  - ${jobRows.toLocaleString()} backfill_jobs row(s) (so a fresh backfill isn't skipped as "already completed")`
    );
  }

  if (!anyDataRows && jobRows === 0) {
    console.log("\nNothing to delete — this domain is already empty.");
    return;
  }

  if (args.dryRun) {
    console.log("\n--dry-run: nothing deleted.");
    return;
  }

  console.log("\nThis cannot be undone.");

  if (!args.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Type "RESET ${canonicalKey}" to confirm: `);
    rl.close();
    if (answer.trim() !== `RESET ${canonicalKey}`) {
      console.log("Confirmation did not match — aborted, nothing deleted.");
      return;
    }
  }

  const deletedCounts: Record<string, number> = {};
  for (const t of targets) {
    const n = await deleteRows(admin, t.table, t.filter);
    deletedCounts[t.table] = (deletedCounts[t.table] ?? 0) + n;
    console.log(`Deleted ${n.toLocaleString()} row(s) from ${t.table}.`);
  }
  for (const domain of spec.backfillJobDomains) {
    const n = await deleteRows(admin, "backfill_jobs", { column: "domain", value: domain });
    console.log(`Cleared ${n.toLocaleString()} backfill_jobs row(s) for domain "${domain}".`);
  }

  // Best-effort audit trail. This script bypasses the authenticated admin
  // API (it runs with the service-role key directly, same as
  // seed-super-admin.ts), so there's no logged-in actor to attribute this
  // to — actor_id is nullable on audit_log for exactly this case. A failure
  // here never undoes or blocks the delete above; it's just logged.
  const { error: auditError } = await admin.from("audit_log").insert({
    actor_id: null,
    action: "domain_reset",
    target_table: targets.map((t) => t.table).join(","),
    target_id: canonicalKey,
    changed_fields: { deletedCounts, includeManualEntries: args.includeManual },
    outcome: "success",
  });
  if (auditError) {
    console.warn(`(Could not write an audit_log row: ${auditError.message} — delete still succeeded.)`);
  }

  console.log(
    `\n✅ "${canonicalKey}" is now empty. Re-run its backfill (admin panel` +
      (canonicalKey === "production_conditions" ? ", or the GitHub Actions bulk-ingest workflow," : "") +
      `) to repopulate it.`
  );
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
