import { generateObject } from "ai";
import { withAiFallback } from "@/lib/ai-models";
import {
  ScenarioSetSchema,
  buildScenarioPrompt,
  type ScenarioGenerationInput,
  type ScenarioSet,
} from "./scenario-logic";

/**
 * Generates one domain-agnostic scenario set (three branches: do_nothing,
 * act_a, act_b) via the shared AI_FALLBACK_CHAIN (src/lib/ai-models.ts).
 *
 * Deliberately thin — mirrors how the three existing route handlers
 * (src/app/api/{chat,ingest,production-conditions-brief}/route.ts) each
 * call withAiFallback + generateObject directly rather than through their
 * own wrapper. This function exists so that wiring (Step 2, not started) is
 * the same one call for every domain instead of each domain's route
 * reimplementing the generateObject/schema/timeout boilerplate.
 *
 * No domain calls this yet, and nothing here persists the result to
 * scenario_predictions — that's the caller's job once Step 2 wires a real
 * domain and route to it. Matches this codebase's existing testing
 * boundary: like every other withAiFallback call site, this function is not
 * unit tested directly (mocking the `ai` package isn't done anywhere else
 * in this codebase either — see tests/ai-models.test.ts for where the
 * fallback mechanism itself is proven, and tests/scenario-logic.test.ts for
 * where this file's prompt/schema logic is proven); it gets the same
 * manual first-live-run verification every other AI call site does, once
 * Step 2 actually wires it into a route.
 */
export async function generateScenario(input: ScenarioGenerationInput): Promise<ScenarioSet> {
  const result = await withAiFallback((model) =>
    generateObject({
      model,
      schema: ScenarioSetSchema,
      prompt: buildScenarioPrompt(input),
      abortSignal: AbortSignal.timeout(40_000),
    })
  );
  return result.object;
}
