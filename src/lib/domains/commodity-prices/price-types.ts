import { TRACKED_COMMODITIES as PRODUCTION_TRACKED_COMMODITIES } from "@/lib/domains/production-conditions/ingest-logic";
import type {
  CommodityPriceEntryPayload,
  CommodityPriceSource,
} from "@/lib/domains/commodity-prices/entry-schema";

/**
 * Shared types and pure reconciliation logic for the commodity_prices
 * domain, now that it's a mix of automated sources (NBS, World Bank RTFP —
 * written to commodity_price_observations) and a manual one (AFEX, and any
 * ad hoc "OTHER" entry — written to manual_data_entries). Nothing here
 * touches a database; see nbs-fetch.ts/worldbank-rtfp-fetch.ts for the
 * network side and CommodityPricesCard.tsx for where this gets called.
 */

export type PriceType = "retail" | "wholesale" | "exchange_spot" | "farmgate";

/**
 * Reuse production_conditions' own TRACKED_COMMODITIES list rather than a
 * second copy — the user explicitly asked for commodity pricing to cover
 * the same commodities tracked there (originally 15, grown since by two
 * further rounds of additions), and keeping one source of truth means a
 * future change to that list doesn't need to be mirrored by hand here. Not
 * yet consumed anywhere else in this codebase — NBS/World Bank RTFP each
 * match against their own small, separately-researched item-name list
 * (see nbs-ingest-logic.ts/worldbank-rtfp-ingest-logic.ts), and the manual
 * commodity_prices entry form accepts any free-form commodity string
 * rather than constraining to this list.
 */
export const TRACKED_PRICE_COMMODITIES: string[] = PRODUCTION_TRACKED_COMMODITIES.map(
  (c) => c.commodity
);

/**
 * Which price_type each source's figures actually represent. This is the
 * one piece of domain knowledge that keeps reconcileCommodityPrices from
 * averaging incompatible things: NBS, World Bank RTFP, and FEWS NET all
 * measure household/market retail prices (methodologically close enough to
 * compare directly — FEWS NET's own price_type field is filtered to
 * "retail" rows only before a row ever reaches this function, see
 * fewsnet-ingest-logic.ts), while AFEX is an exchange's own spot price for
 * a traded contract — a structurally different measurement that stays
 * visible on its own rather than getting blended into a "retail average".
 */
export function priceTypeForSource(
  source: CommodityPriceSource | "NBS" | "WORLD_BANK_RTFP" | "FEWS_NET"
): PriceType {
  switch (source) {
    case "NBS":
    case "NBS_HFP":
      return "retail";
    case "WORLD_BANK_RTFP":
      return "retail";
    case "FEWS_NET":
      return "retail";
    case "AFEX":
      return "exchange_spot";
    case "OTHER":
    default:
      // A free-form manual entry with no more specific source — treated as
      // retail (the most common case for a staffer keying in an observed
      // market price) rather than silently dropped from reconciliation.
      // sourceNote on the manual_data_entries row (not part of this
      // payload) is where the real provenance detail lives.
      return "retail";
  }
}

/**
 * Normalizes one published manual_data_entries row (AFEX, or an ad hoc
 * "OTHER" submission) into the same shape commodity_price_observations'
 * automated rows already use — what lets CommodityPricesCard merge both
 * tables into one reconcileCommodityPrices() call instead of rendering
 * two separate, unrelated lists.
 */
export function normalizeManualCommodityEntry(entry: {
  entryDate: string;
  payload: CommodityPriceEntryPayload;
}): NormalizedPriceObservation {
  return {
    commodity: entry.payload.commodity,
    source: entry.payload.source,
    priceType: priceTypeForSource(entry.payload.source),
    value: entry.payload.price,
    unit: entry.payload.unit,
    currency: entry.payload.currency,
    periodDate: entry.entryDate,
    region: entry.payload.market,
    rawItemLabel: entry.payload.commodity,
  };
}

export interface NormalizedPriceObservation {
  commodity: string;
  source: string; // "NBS" | "WORLD_BANK_RTFP" | "AFEX" | "OTHER"
  priceType: PriceType;
  value: number;
  unit: string;
  currency: string;
  periodDate: string; // YYYY-MM-DD
  region: string;
  rawItemLabel?: string | null;
}

export interface ReconciledCommodityPrice {
  commodity: string;
  priceType: PriceType;
  unit: string;
  currency: string;
  region: string;
  /** The most recent period among the grouped observations. */
  periodDate: string;
  /** Each contributing source's own most recent figure, kept visible. */
  observations: NormalizedPriceObservation[];
  /** Mean of the observations' values. null when fewer than two sources agree on commodity + priceType + unit + currency + region — there's nothing to average yet, and this is never silently filled in with a single source's figure relabeled as an "average". */
  average: number | null;
}

/**
 * Groups normalized observations by (commodity, priceType, unit, currency,
 * region), keeps only each source's single most recent observation within
 * a group (a "current best estimate" per source, since NBS/World Bank
 * RTFP/AFEX update on different cadences and will rarely share an exact
 * period_date), and averages across sources only within a group — which by
 * construction never mixes a retail figure with an exchange_spot one, or a
 * NGN/kg figure with a NGN/tonne one.
 */
export function reconcileCommodityPrices(
  observations: NormalizedPriceObservation[]
): ReconciledCommodityPrice[] {
  const groups = new Map<string, NormalizedPriceObservation[]>();

  for (const obs of observations) {
    const key = [obs.commodity, obs.priceType, obs.unit, obs.currency, obs.region].join("::");
    const bucket = groups.get(key) ?? [];
    bucket.push(obs);
    groups.set(key, bucket);
  }

  const results: ReconciledCommodityPrice[] = [];

  for (const bucket of groups.values()) {
    // Keep only the most recent observation per source within this group.
    const latestBySource = new Map<string, NormalizedPriceObservation>();
    for (const obs of bucket) {
      const existing = latestBySource.get(obs.source);
      if (!existing || obs.periodDate > existing.periodDate) {
        latestBySource.set(obs.source, obs);
      }
    }
    const latest = Array.from(latestBySource.values()).sort((a, b) =>
      a.source.localeCompare(b.source)
    );
    if (latest.length === 0) continue;

    const mostRecentPeriod = latest.reduce(
      (max, o) => (o.periodDate > max ? o.periodDate : max),
      latest[0].periodDate
    );

    const average =
      latest.length >= 2 ? latest.reduce((sum, o) => sum + o.value, 0) / latest.length : null;

    const first = latest[0];
    results.push({
      commodity: first.commodity,
      priceType: first.priceType,
      unit: first.unit,
      currency: first.currency,
      region: first.region,
      periodDate: mostRecentPeriod,
      observations: latest,
      average,
    });
  }

  return results.sort((a, b) => a.commodity.localeCompare(b.commodity));
}

/**
 * Compact, per-source recent-history text for one reconciled
 * (commodity, priceType, unit, currency, region) group — the
 * commodity_prices equivalent of
 * production-conditions/brief-logic.ts's buildCompactProductionTelemetry(),
 * used as the `compactTelemetry` input to
 * src/lib/scenarios/generate-scenario.ts (Sub-phase 6 Step 2). Pure: takes
 * whatever observations the caller already fetched for this one group (not
 * every commodity, unlike reconcileCommodityPrices above) and has no
 * opinion on how many rows that is or where they came from — a route
 * handler fetches by (commodity, priceType, unit, currency, region) and
 * passes the result straight through.
 *
 * Grouped by source rather than flattened chronologically, same reasoning
 * as the production-conditions equivalent: NBS, World Bank RTFP and AFEX
 * each update on their own cadence, so interleaving them by date would make
 * a within-source trend harder to read than grouping by source first.
 */
const MAX_PERIODS_PER_SOURCE = 4;

export function buildCompactPriceTelemetry(observations: NormalizedPriceObservation[]): string {
  const bySource = new Map<string, NormalizedPriceObservation[]>();
  for (const obs of observations) {
    const list = bySource.get(obs.source) ?? [];
    list.push(obs);
    bySource.set(obs.source, list);
  }

  const lines: string[] = [];
  for (const [source, obsForSource] of [...bySource.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const sorted = [...obsForSource]
      .sort((a, b) => (a.periodDate < b.periodDate ? 1 : -1))
      .slice(0, MAX_PERIODS_PER_SOURCE);
    const figs = sorted
      .map((o) => `${o.currency} ${o.value.toLocaleString()}/${o.unit} (${o.periodDate})`)
      .join(", ");
    lines.push(`${source}: ${figs}`);
  }

  return lines.join("\n");
}
