import { TRACKED_COMMODITIES } from "@/lib/domains/production-conditions/ingest-logic";

/**
 * Static reference module for the geo-intelligence domain: which of the 32
 * nationally-tracked commodities (TRACKED_COMMODITIES, in
 * production-conditions/ingest-logic.ts) are actually grown or raised in each
 * of the 29 weather clusters (weather_clusters, seeded in schema.sql + the 5
 * added by migration 0010).
 *
 * WHY THIS EXISTS: production_conditions and commodity_prices are both
 * national-level data sources (FAOSTAT and NBS/World Bank RTFP/AFEX/FEWS NET
 * respectively have no sub-national breakdown this product ingests). There is
 * no live, per-cluster production or price figure to show. Per the user's
 * explicit decision (2026-11-27), the geo-intelligence feature instead shows
 * the REAL national figures for whichever commodities are associated with a
 * selected cluster's named crops, clearly labeled "national-level, not
 * cluster-specific" — rather than fabricating a per-cluster number or hiding
 * the panel. This module is what decides "which national commodities are
 * relevant to this cluster."
 *
 * CONFIDENCE LEVEL: this is general agricultural-geography knowledge (which
 * crops a named LGA/state cluster is known for), not a FAOSTAT sub-national
 * breakdown — FAOSTAT doesn't publish one for Nigeria. Treat each cluster's
 * list as "crops this area is known to grow," researched against named-LGA
 * agricultural reporting (the same sourcing discipline as migration 0010's
 * header comment for the 5 new clusters), not as a precise, surveyed
 * cluster-level production share. Livestock commodities (Cattle meat, Cow
 * milk) are only listed for clusters with a real pastoral/dairy identity
 * (Mambilla) since most clusters here are crop-focused.
 *
 * Every commodity string below must exactly match a `commodity` value in
 * TRACKED_COMMODITIES (ingest-logic.ts) or `assertCommoditiesAreTracked()`
 * below throws at module load — this keeps the mapping from silently
 * drifting out of sync if TRACKED_COMMODITIES is ever renamed.
 */

export const CLUSTER_COMMODITIES: Record<string, string[]> = {
  // South-East
  "anambra-ayamelum": ["Rice (paddy)", "Yams", "Cassava"],
  "ebonyi-abakaliki": ["Rice (paddy)", "Yams"],
  "enugu-adani": ["Rice (paddy)", "Yams", "Cassava"],
  "imo-abia": ["Cassava", "Oil palm fruit", "Yams"],

  // South-South
  "edo-ovia": ["Oil palm fruit", "Cassava"],
  "cross-river-ikom": ["Cocoa beans", "Oil palm fruit", "Cassava"],
  "delta-ethiope": ["Oil palm fruit", "Cassava", "Yams"],
  "akwa-ibom-rivers": ["Oil palm fruit", "Cassava"],
  "bayelsa-ogbia": ["Yams", "Cassava", "Plantains", "Oil palm fruit"],

  // North-West
  "kano-kadawa": ["Rice (paddy)", "Tomatoes", "Maize"],
  "kebbi-argungu": ["Rice (paddy)"],
  "jigawa-hadejia": ["Rice (paddy)", "Millet", "Cowpeas"],
  "zamfara-katsina": ["Millet", "Sorghum", "Groundnuts", "Seed cotton"],
  "kaduna-kachia": ["Ginger", "Maize"],
  "sokoto-rima": ["Rice (paddy)", "Millet", "Sorghum"],

  // North-East
  "taraba-mambilla": ["Cattle meat", "Cow milk", "Potatoes"],
  "gombe-yamaltu": ["Groundnuts", "Millet", "Sorghum", "Seed cotton"],
  "adamawa-benue": ["Maize", "Sorghum", "Seed cotton", "Groundnuts"],
  "borno-yobe": ["Millet", "Sorghum", "Cowpeas", "Groundnuts"],

  // North-Central
  "benue-gboko": ["Soya beans", "Yams", "Rice (paddy)", "Cassava"],
  "niger-mokwa": ["Rice (paddy)", "Yams", "Sesame seed"],
  "nasarawa-doma": ["Rice (paddy)", "Sesame seed", "Soya beans"],
  "plateau-jos": ["Potatoes", "Carrots and turnips", "Cabbages"],
  "kogi-confluence": ["Cassava", "Rice (paddy)"],
  "kwara-edu-patigi": ["Rice (paddy)", "Maize", "Soya beans"],

  // South-West
  "ondo-idanre": ["Cocoa beans", "Oil palm fruit", "Oranges"],
  "oyo-oke-ogun": ["Maize", "Cassava", "Yams"],
  "ogun-yewa": ["Cassava", "Oil palm fruit", "Maize"],
  "ekiti-osun": ["Cocoa beans", "Oranges", "Cassava"],
};

function assertCommoditiesAreTracked() {
  const trackedNames = new Set(TRACKED_COMMODITIES.map((c) => c.commodity));
  for (const [slug, commodities] of Object.entries(CLUSTER_COMMODITIES)) {
    for (const commodity of commodities) {
      if (!trackedNames.has(commodity)) {
        throw new Error(
          `cluster-commodities.ts: cluster "${slug}" references commodity "${commodity}", which is not in TRACKED_COMMODITIES (ingest-logic.ts). Fix the typo or add the commodity there first.`
        );
      }
    }
  }
}
assertCommoditiesAreTracked();

/** Returns the associated commodity names for a cluster slug, or [] if the slug is unknown (e.g. not yet added to this map). */
export function getClusterCommodities(slug: string): string[] {
  return CLUSTER_COMMODITIES[slug] ?? [];
}
