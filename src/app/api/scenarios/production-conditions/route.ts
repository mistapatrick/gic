import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";
import { generateScenario } from "@/lib/scenarios/generate-scenario";
import type { ScenarioGenerationInput } from "@/lib/scenarios/scenario-logic";
import { getProductionConditionsResolutionHorizon } from "@/lib/scenarios/resolution-horizon";
import {
  buildCompactProductionTelemetry,
  type ProductionBriefRow,
} from "@/lib/domains/production-conditions/brief-logic";
import { getCropCategory } from "@/lib/domains/production-conditions/crop-emoji";

/**
 * Sub-phase 6 Step 2 pilot route (production_conditions side) — see
 * claude/gic-phase-1-build-plan.md. User-triggered (a "Generate Business
 * Scenarios" button on ProductionConditionsCard.tsx, never called
 * automatically on page load), so this is a POST taking a specific
 * commodity rather than a GET generating for everything — keeps each call
 * small enough to fit comfortably inside the AI fallback chain's 40s budget
 * and matches the exit criteria's "a failure generating one commodity's
 * scenario doesn't block another's".
 *
 * Unlike the read-only production-conditions-brief route, this one both
 * calls the AI (spends AI_FALLBACK_CHAIN free-tier quota) and writes to
 * scenario_predictions — the first scenario route to exist, and per
 * Sub-phase 6's own checklist item 4, the first route in this codebase that
 * actually needs the rate limiter applied to an AI-generation endpoint (the
 * read-only brief/chat routes already had it or didn't need it; see
 * src/lib/rate-limit.ts).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby plan's ceiling — same budget as /api/chat.

// Tighter than /api/chat's 10/min: this is a deliberate, occasional button
// click (not a back-and-forth chat), and every request spends an
// AI_FALLBACK_CHAIN call plus a scenario_predictions write, both worth
// conserving more aggressively than a read-only chat turn.
const RATE_LIMIT = { limit: 5, windowMs: 10 * 60_000 };

const RequestSchema = z.object({
  commodity: z.string().min(1).max(200),
});

interface ProductionRowWithId extends ProductionBriefRow {
  id: number;
}

export async function POST(req: NextRequest) {
  const clientKey = getClientKey(req);
  const rl = checkRateLimit(`scenarios:production-conditions:${clientKey}`, RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many scenario requests. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil((rl.resetAt - Date.now()) / 1000).toString() },
      }
    );
  }

  // Server-side re-check: the button that calls this route is itself
  // hidden while this flag is off, but that's a UI convenience, not the
  // access control — a direct POST must be refused the same way.
  const enabled = await isFeatureEnabled("production_conditions_scenarios");
  if (!enabled) {
    return NextResponse.json({ error: "Business scenarios are not enabled." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }
  const { commodity } = parsed.data;

  const supabase = getSupabaseBrowserClient();
  const [automatedRes, manualRes] = await Promise.all([
    supabase
      .from("production_conditions")
      .select("id, commodity, metric, value, unit, year")
      .eq("region", "National")
      .eq("commodity", commodity)
      .order("year", { ascending: false }),
    supabase
      .from("manual_data_entries")
      .select("payload")
      .eq("domain", "production_conditions")
      .eq("status", "published"),
  ]);

  if (automatedRes.error || manualRes.error) {
    console.error(
      "[scenarios/production-conditions] query failed:",
      automatedRes.error ?? manualRes.error
    );
    return NextResponse.json({ error: "Could not load production conditions data." }, { status: 500 });
  }

  const automated = (automatedRes.data as ProductionRowWithId[]) ?? [];
  const manual: ProductionRowWithId[] = ((manualRes.data as { payload: ProductionBriefRow & { region: string } }[]) ?? [])
    .filter((entry) => entry.payload.region === "National" && entry.payload.commodity === commodity)
    // Manual entries have no production_conditions.id of their own to point
    // signal_source_id at — 0 is never a real identity-column value (bigint
    // generated always as identity starts at 1), so this is an unambiguous
    // "not a production_conditions row" marker rather than a guess.
    .map((entry) => ({ ...entry.payload, id: 0 }));

  const rows = [...automated, ...manual];
  if (rows.length === 0) {
    return NextResponse.json(
      { error: `No production data for "${commodity}" yet — nothing to model scenarios from.` },
      { status: 404 }
    );
  }

  const compactTelemetry = buildCompactProductionTelemetry(rows);
  const mostRecentAutomated = automated.sort((a, b) => b.year - a.year)[0];
  const horizon = getProductionConditionsResolutionHorizon(new Date());

  const input: ScenarioGenerationInput = {
    domain: "production_conditions",
    commodity,
    agricultureType: getCropCategory(commodity) === "Livestock products" ? "livestock" : "crop",
    region: "National",
    compactTelemetry,
    resolutionHorizonDescription: horizon.description,
  };

  let scenario;
  try {
    scenario = await generateScenario(input);
  } catch (err) {
    console.error("[scenarios/production-conditions] AI generation failed:", err);
    return NextResponse.json(
      { error: "Scenario modeling is temporarily unavailable. Please try again shortly." },
      { status: 502 }
    );
  }

  // Persist every branch at generation time — this is the actual point of
  // Step 2 (it's what makes Step 3/4's adaptation and resolution tracking
  // possible later), so a failure here is a hard error rather than a
  // silently-degraded response: showing the user a scenario that was never
  // logged would quietly defeat the whole point of this round's work.
  const admin = getSupabaseAdminClient();
  const { error: insertError } = await admin.from("scenario_predictions").insert(
    scenario.branches.map((branch) => ({
      signal_source_table: "production_conditions",
      signal_source_id: mostRecentAutomated?.id ?? null,
      commodity,
      region: "National",
      agriculture_type: input.agricultureType,
      branch: branch.branch,
      narrative: branch.narrative,
      predicted_range_low: branch.predicted_range_low,
      predicted_range_high: branch.predicted_range_high,
      unit: branch.unit,
      confidence_label: branch.confidence_label,
      force_majeure_caveat: branch.force_majeure_caveat,
      target_resolution_date: horizon.targetResolutionDate,
      resolution_metric: `FAOSTAT production_quantity for ${commodity}, National, ${horizon.description}`,
    }))
  );

  if (insertError) {
    console.error("[scenarios/production-conditions] persisting scenario_predictions failed:", insertError);
    return NextResponse.json(
      { error: "Scenario was generated but could not be recorded. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json(scenario);
}
