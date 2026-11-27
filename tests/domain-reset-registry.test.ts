import { describe, it, expect } from "vitest";
import {
  DOMAIN_RESET_REGISTRY,
  resolveDomainKey,
  listDomainKeys,
  describeDomainsForHelp,
} from "../src/lib/ingestion/domain-reset-registry";
import { BACKFILL_DOMAINS } from "../src/lib/ingestion/domain-adapters";

describe("domain-reset-registry", () => {
  it("every registered domain has at least one delete target", () => {
    for (const spec of Object.values(DOMAIN_RESET_REGISTRY)) {
      expect(spec.targets.length).toBeGreaterThan(0);
    }
  });

  it("every backfillJobDomains entry is a real registered backfill domain", () => {
    const known = new Set(BACKFILL_DOMAINS);
    for (const spec of Object.values(DOMAIN_RESET_REGISTRY)) {
      for (const domain of spec.backfillJobDomains) {
        expect(known.has(domain)).toBe(true);
      }
    }
  });

  it("never targets weather_clusters, user_roles, audit_log, or feature_flags", () => {
    const forbidden = new Set(["weather_clusters", "user_roles", "audit_log", "feature_flags"]);
    for (const spec of Object.values(DOMAIN_RESET_REGISTRY)) {
      for (const target of spec.targets) {
        expect(forbidden.has(target.table)).toBe(false);
      }
    }
  });

  it("scenario_predictions deletes prediction_outcomes before scenario_predictions (FK order)", () => {
    const spec = DOMAIN_RESET_REGISTRY.scenario_predictions;
    const tables = spec.targets.map((t) => t.table);
    expect(tables.indexOf("prediction_outcomes")).toBeLessThan(tables.indexOf("scenario_predictions"));
  });

  it("resolves canonical keys case/whitespace-insensitively", () => {
    expect(resolveDomainKey("weather")).toBe("weather");
    expect(resolveDomainKey("  Weather  ")).toBe("weather");
    expect(resolveDomainKey("WEATHER")).toBe("weather");
  });

  it("resolves known aliases to their canonical key", () => {
    expect(resolveDomainKey("fao")).toBe("production_conditions");
    expect(resolveDomainKey("FAOSTAT")).toBe("production_conditions");
    expect(resolveDomainKey("nbs")).toBe("commodity_prices_nbs");
    expect(resolveDomainKey("rtfp")).toBe("commodity_prices_worldbank_rtfp");
    expect(resolveDomainKey("world_bank_rtfp")).toBe("commodity_prices_worldbank_rtfp");
    expect(resolveDomainKey("fewsnet")).toBe("commodity_prices_fewsnet");
    expect(resolveDomainKey("scenarios")).toBe("scenario_predictions");
  });

  it("returns null for an unknown domain", () => {
    expect(resolveDomainKey("bauchi")).toBeNull();
    expect(resolveDomainKey(undefined)).toBeNull();
    expect(resolveDomainKey("")).toBeNull();
  });

  it("only production_conditions and commodity_prices declare a manual-entry counterpart", () => {
    const withManual = Object.values(DOMAIN_RESET_REGISTRY)
      .filter((spec) => spec.manualEntryDomain)
      .map((spec) => spec.key)
      .sort();
    expect(withManual).toEqual(["commodity_prices", "production_conditions"]);
  });

  it("listDomainKeys matches the registry's own keys", () => {
    expect(new Set(listDomainKeys())).toEqual(new Set(Object.keys(DOMAIN_RESET_REGISTRY)));
  });

  it("help text mentions every domain key and the core flags", () => {
    const help = describeDomainsForHelp();
    for (const key of listDomainKeys()) {
      expect(help).toContain(key);
    }
    expect(help).toContain("--dry-run");
    expect(help).toContain("--yes");
    expect(help).toContain("--include-manual-entries");
  });
});
