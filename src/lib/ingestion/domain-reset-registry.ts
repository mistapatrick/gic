import "server-only";
import { BACKFILL_DOMAINS } from "@/lib/ingestion/domain-adapters";

/**
 * Pure reference data for scripts/reset-domain-data.ts — "empty this
 * domain's data and start fresh." Kept separate from the script itself (no
 * Supabase client, no readline, no process.exit) so it's unit-testable and
 * so the mapping from a human-typed domain name to the real tables/filters
 * it touches lives in exactly one place, not duplicated inline in the
 * script.
 *
 * What a domain reset NEVER touches, by design:
 *   - weather_clusters — cluster reference/dimension data, not an ingested
 *     observation. Deleting it would break every domain that joins against
 *     it (geo-intelligence, crop-calendar), not just "start weather fresh."
 *   - user_roles / audit_log / feature_flags — app configuration, not
 *     domain data.
 *   - manual_data_entries — human-submitted records. Unlike an automated
 *     source, these can't be "started fresh" by re-running a cron; wiping
 *     them is a materially different, less reversible action, so a domain
 *     with a manual-entry counterpart only has it cleared when the caller
 *     explicitly opts in (see `manualEntryDomain` below and
 *     scripts/reset-domain-data.ts's --include-manual-entries flag).
 *
 * What it DOES clear alongside the domain's own data tables:
 *   - the matching backfill_jobs row(s). A job row with status
 *     "completed" makes /api/admin/backfill silently no-op on the same
 *     date range (see src/app/api/admin/backfill/route.ts) — without
 *     clearing it, "wipe the data, then backfill again" would look like it
 *     worked but write nothing back.
 */

export interface DomainResetFilter {
  column: string;
  value: string;
}

export interface DomainResetTarget {
  table: string;
  filter?: DomainResetFilter;
}

export interface DomainResetSpec {
  /** Canonical key, also what the operator types to select this domain. */
  key: string;
  /** Short human label for confirmation prompts and --list output. */
  label: string;
  /** Tables (with an optional column=value filter) this reset deletes from. */
  targets: DomainResetTarget[];
  /**
   * backfill_jobs.domain value(s) to also clear. Must each be a real key
   * registered in domain-adapters.ts's ADAPTER_FACTORIES — enforced below
   * by assertBackfillDomainsAreRegistered() so a future rename there can't
   * silently leave a stale, unmatched key here.
   */
  backfillJobDomains: string[];
  /**
   * If this domain has a manual-entry counterpart, the manual_data_entries
   * .domain value that covers it — e.g. "commodity_prices" also holds
   * AFEX's manually entered observations alongside the automated NBS/World
   * Bank RTFP/FEWS NET rows in commodity_price_observations. Left undefined
   * when there is none (weather, food_security — neither is a manual-entry
   * domain today).
   */
  manualEntryDomain?: string;
}

export const DOMAIN_RESET_REGISTRY: Record<string, DomainResetSpec> = {
  weather: {
    key: "weather",
    label: "Weather (hourly observations + daily reports, all 29 clusters)",
    targets: [{ table: "observed_hourly" }, { table: "daily_observed_reports" }],
    backfillJobDomains: ["weather"],
  },
  production_conditions: {
    key: "production_conditions",
    label: "Production conditions (FAOSTAT)",
    targets: [{ table: "production_conditions" }],
    backfillJobDomains: ["production_conditions", "production_conditions_bulk"],
    manualEntryDomain: "production_conditions",
  },
  commodity_prices_nbs: {
    key: "commodity_prices_nbs",
    label: "Commodity prices — NBS only",
    targets: [{ table: "commodity_price_observations", filter: { column: "source", value: "NBS" } }],
    backfillJobDomains: ["commodity_prices_nbs"],
  },
  commodity_prices_worldbank_rtfp: {
    key: "commodity_prices_worldbank_rtfp",
    label: "Commodity prices — World Bank RTFP only",
    targets: [
      { table: "commodity_price_observations", filter: { column: "source", value: "WORLD_BANK_RTFP" } },
    ],
    backfillJobDomains: ["commodity_prices_worldbank_rtfp"],
  },
  commodity_prices_fewsnet: {
    key: "commodity_prices_fewsnet",
    label: "Commodity prices — FEWS NET only",
    targets: [
      { table: "commodity_price_observations", filter: { column: "source", value: "FEWS_NET" } },
    ],
    backfillJobDomains: ["commodity_prices_fewsnet"],
  },
  commodity_prices: {
    key: "commodity_prices",
    label: "Commodity prices — ALL automated sources (NBS + World Bank RTFP + FEWS NET)",
    targets: [{ table: "commodity_price_observations" }],
    backfillJobDomains: [
      "commodity_prices_nbs",
      "commodity_prices_worldbank_rtfp",
      "commodity_prices_fewsnet",
    ],
    // AFEX has no separate key above — it only ever lives in
    // manual_data_entries (domain "commodity_prices"), never in
    // commodity_price_observations, so it only gets cleared here, and only
    // with --include-manual-entries.
    manualEntryDomain: "commodity_prices",
  },
  food_security: {
    key: "food_security",
    label: "Food security (HDX HAPI IPC/Cadre Harmonisé)",
    targets: [{ table: "food_security_observations" }],
    backfillJobDomains: ["food_security"],
  },
  scenario_predictions: {
    key: "scenario_predictions",
    label: "AI-generated business scenarios + their resolved outcomes",
    // prediction_outcomes first: it has a not-null FK to scenario_predictions.id.
    targets: [{ table: "prediction_outcomes" }, { table: "scenario_predictions" }],
    backfillJobDomains: [], // not a backfill-framework domain
  },
};

/** Alternate names an operator might reasonably type for a domain above. */
const DOMAIN_ALIASES: Record<string, string> = {
  fao: "production_conditions",
  faostat: "production_conditions",
  nbs: "commodity_prices_nbs",
  worldbank_rtfp: "commodity_prices_worldbank_rtfp",
  world_bank_rtfp: "commodity_prices_worldbank_rtfp",
  rtfp: "commodity_prices_worldbank_rtfp",
  fewsnet: "commodity_prices_fewsnet",
  fews_net: "commodity_prices_fewsnet",
  scenarios: "scenario_predictions",
  predictions: "scenario_predictions",
};

/** Case/whitespace-insensitive lookup; resolves aliases to a canonical key. */
export function resolveDomainKey(input: string | undefined): string | null {
  if (!input) return null;
  const normalized = input.trim().toLowerCase();
  if (DOMAIN_RESET_REGISTRY[normalized]) return normalized;
  const aliased = DOMAIN_ALIASES[normalized];
  if (aliased && DOMAIN_RESET_REGISTRY[aliased]) return aliased;
  return null;
}

export function listDomainKeys(): string[] {
  return Object.keys(DOMAIN_RESET_REGISTRY);
}

function assertBackfillDomainsAreRegistered(): void {
  const known = new Set(BACKFILL_DOMAINS);
  for (const spec of Object.values(DOMAIN_RESET_REGISTRY)) {
    for (const domain of spec.backfillJobDomains) {
      if (!known.has(domain)) {
        throw new Error(
          `domain-reset-registry: "${spec.key}" references backfill domain "${domain}", ` +
            `which is not registered in domain-adapters.ts's ADAPTER_FACTORIES. ` +
            `Fix the registry or the adapter key before this ships.`
        );
      }
    }
  }
}
assertBackfillDomainsAreRegistered();

export function describeDomainsForHelp(): string {
  const lines = [
    "Usage:",
    "  npm run reset-domain -- <domain> [--dry-run] [--yes] [--include-manual-entries]",
    "  npm run reset-domain -- --list",
    "",
    "Domains:",
  ];
  for (const spec of Object.values(DOMAIN_RESET_REGISTRY)) {
    lines.push(`  ${spec.key.padEnd(32)} ${spec.label}`);
    if (spec.manualEntryDomain) {
      lines.push(
        `  ${"".padEnd(32)} (+ --include-manual-entries also clears its manually entered rows)`
      );
    }
  }
  lines.push("", "Aliases: " + Object.keys(DOMAIN_ALIASES).sort().join(", "));
  lines.push(
    "",
    "Flags:",
    "  --dry-run                 show row counts, delete nothing",
    "  --yes                     skip the typed confirmation prompt",
    "  --include-manual-entries  also delete human-submitted manual_data_entries rows for this domain",
    "  --list, -l                print this domain list",
    "  --help, -h                print this help"
  );
  return lines.join("\n");
}
