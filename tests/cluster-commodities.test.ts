import { describe, it, expect } from "vitest";
import { CLUSTER_COMMODITIES, getClusterCommodities } from "@/lib/domains/geo-intelligence/cluster-commodities";
import { TRACKED_COMMODITIES } from "@/lib/domains/production-conditions/ingest-logic";

// The 29 weather_clusters slugs as seeded (24 in schema.sql + 5 in migration
// 0010). Kept here as a literal list (not re-derived from the mapping under
// test) so a typo'd or accidentally-deleted cluster slug in
// cluster-commodities.ts actually fails this test instead of passing
// vacuously.
const EXPECTED_CLUSTER_SLUGS = [
  "anambra-ayamelum",
  "ebonyi-abakaliki",
  "enugu-adani",
  "imo-abia",
  "edo-ovia",
  "cross-river-ikom",
  "delta-ethiope",
  "akwa-ibom-rivers",
  "bayelsa-ogbia",
  "kano-kadawa",
  "kebbi-argungu",
  "jigawa-hadejia",
  "zamfara-katsina",
  "kaduna-kachia",
  "sokoto-rima",
  "taraba-mambilla",
  "gombe-yamaltu",
  "adamawa-benue",
  "borno-yobe",
  "benue-gboko",
  "niger-mokwa",
  "nasarawa-doma",
  "plateau-jos",
  "kogi-confluence",
  "kwara-edu-patigi",
  "ondo-idanre",
  "oyo-oke-ogun",
  "ogun-yewa",
  "ekiti-osun",
];

describe("cluster-commodities", () => {
  it("covers all 29 weather clusters, each with at least one commodity", () => {
    expect(Object.keys(CLUSTER_COMMODITIES).sort()).toEqual([...EXPECTED_CLUSTER_SLUGS].sort());
    for (const slug of EXPECTED_CLUSTER_SLUGS) {
      expect(CLUSTER_COMMODITIES[slug]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("every referenced commodity exists in TRACKED_COMMODITIES", () => {
    const trackedNames = new Set(TRACKED_COMMODITIES.map((c) => c.commodity));
    for (const commodities of Object.values(CLUSTER_COMMODITIES)) {
      for (const commodity of commodities) {
        expect(trackedNames.has(commodity)).toBe(true);
      }
    }
  });

  it("getClusterCommodities returns the mapped list for a known slug", () => {
    expect(getClusterCommodities("kaduna-kachia")).toEqual(["Ginger", "Maize"]);
  });

  it("getClusterCommodities returns [] for an unknown slug", () => {
    expect(getClusterCommodities("not-a-real-cluster")).toEqual([]);
  });

  it("includes the 5 clusters added by migration 0010, matching their header-comment crops", () => {
    expect(getClusterCommodities("kaduna-kachia")).toContain("Ginger");
    expect(getClusterCommodities("sokoto-rima")).toContain("Rice (paddy)");
    expect(getClusterCommodities("kogi-confluence")).toContain("Cassava");
    expect(getClusterCommodities("kwara-edu-patigi")).toContain("Rice (paddy)");
    expect(getClusterCommodities("bayelsa-ogbia")).toEqual(
      expect.arrayContaining(["Yams", "Cassava", "Plantains", "Oil palm fruit"])
    );
  });
});
