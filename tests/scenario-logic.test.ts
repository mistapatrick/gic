import { describe, expect, it } from "vitest";
import {
  AGRICULTURE_TYPES,
  CONFIDENCE_LABELS,
  SCENARIO_BRANCHES,
  ScenarioSetSchema,
  buildScenarioPrompt,
  type ScenarioBranch,
  type ScenarioGenerationInput,
} from "@/lib/scenarios/scenario-logic";

const baseInput: ScenarioGenerationInput = {
  domain: "production_conditions",
  commodity: "Maize",
  agricultureType: "crop",
  region: "National",
  compactTelemetry: "Maize: production 12,000,000 t (2023), 11,500,000 t (2022)",
  resolutionHorizonDescription: "the next FAOSTAT annual release",
};

function validBranchSet(): { branches: ScenarioBranch[] } {
  return {
    branches: SCENARIO_BRANCHES.map((branch) => ({
      branch,
      narrative: `Narrative for ${branch}.`,
      predicted_range_low: 1,
      predicted_range_high: 2,
      unit: "t",
      confidence_label: "moderate",
      force_majeure_caveat: "Flooding could invalidate this.",
    })),
  };
}

describe("SCENARIO_BRANCHES / AGRICULTURE_TYPES / CONFIDENCE_LABELS", () => {
  it("names exactly the three branches the synopsis and migration 0008 specify", () => {
    expect(SCENARIO_BRANCHES).toEqual(["do_nothing", "act_a", "act_b"]);
  });

  it("names Nigeria's three agricultural sub-sectors", () => {
    expect(AGRICULTURE_TYPES).toEqual(["crop", "livestock", "fishery"]);
  });

  it("names three confidence levels", () => {
    expect(CONFIDENCE_LABELS).toEqual(["low", "moderate", "high"]);
  });
});

describe("buildScenarioPrompt", () => {
  it("embeds the commodity, region, agriculture type, and compact telemetry", () => {
    const prompt = buildScenarioPrompt(baseInput);
    expect(prompt).toContain("Maize");
    expect(prompt).toContain("crop");
    expect(prompt).toContain("National");
    expect(prompt).toContain("production 12,000,000 t (2023)");
  });

  it("reads the domain as human-readable words, not a raw table name", () => {
    const prompt = buildScenarioPrompt(baseInput);
    expect(prompt).toContain("production conditions data");
    expect(prompt).not.toContain("production_conditions data");
  });

  it("embeds the resolution horizon description", () => {
    const prompt = buildScenarioPrompt(baseInput);
    expect(prompt).toContain("the next FAOSTAT annual release");
  });

  it("instructs against inventing figures", () => {
    const prompt = buildScenarioPrompt(baseInput);
    expect(prompt.toLowerCase()).toContain("never invent");
  });

  it("instructs exactly three branches by name", () => {
    const prompt = buildScenarioPrompt(baseInput);
    expect(prompt).toContain("do_nothing");
    expect(prompt).toContain("act_a");
    expect(prompt).toContain("act_b");
  });
});

describe("ScenarioSetSchema", () => {
  it("accepts a well-formed set of exactly three branches", () => {
    const result = ScenarioSetSchema.safeParse(validBranchSet());
    expect(result.success).toBe(true);
  });

  it("accepts null predicted_range_low/high/unit for a non-numeric branch", () => {
    const set = validBranchSet();
    set.branches[0] = {
      ...set.branches[0],
      predicted_range_low: null,
      predicted_range_high: null,
      unit: null,
    };
    expect(ScenarioSetSchema.safeParse(set).success).toBe(true);
  });

  it("rejects a set with only two branches", () => {
    const set = validBranchSet();
    set.branches.pop();
    expect(ScenarioSetSchema.safeParse(set).success).toBe(false);
  });

  it("rejects a set with four branches", () => {
    const set = validBranchSet();
    set.branches.push({ ...set.branches[0] });
    expect(ScenarioSetSchema.safeParse(set).success).toBe(false);
  });

  it("rejects an invalid branch id", () => {
    const set = validBranchSet();
    // @ts-expect-error -- deliberately invalid for this test
    set.branches[0].branch = "act_c";
    expect(ScenarioSetSchema.safeParse(set).success).toBe(false);
  });

  it("rejects an invalid confidence_label", () => {
    const set = validBranchSet();
    // @ts-expect-error -- deliberately invalid for this test
    set.branches[0].confidence_label = "certain";
    expect(ScenarioSetSchema.safeParse(set).success).toBe(false);
  });

  it("rejects a branch missing force_majeure_caveat", () => {
    const set = validBranchSet();
    // @ts-expect-error -- deliberately invalid for this test
    delete set.branches[0].force_majeure_caveat;
    expect(ScenarioSetSchema.safeParse(set).success).toBe(false);
  });
});
