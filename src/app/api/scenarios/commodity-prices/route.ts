import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";
import { generateScenario } from "@/lib/scenarios/generate-scenario";
import type { ScenarioGenerationInput } from "@/lib/scenarios/scenario-logic";
import { getCommodityPricesResolutionHorizon } from "@/lib/scenarios/resolution-horizon";
import {
  buildCompactPriceTelemetry,
  normalizeManualCommodityEntry,
  type NormalizedPriceObservation,
  type PriceType,
} from "@/lib/domains/commodity-prices/price-types";
import type { CommodityPriceEntryPayload } from "@/lib/domains/commodity-prices/entry-schema";
import { getCropCategory } from "@/lib/domains/production-conditions/crop-emoji";

/**
 * Sub-phase 6 Step 2 pilot route (commodity_prices side) — the second of
 * the two domains the user explicitly confirmed should be piloted together
 * (see claude/gic-phase-1-build-plan.md, "Sub-phase 6" / "Step 2"). Mirrors
 * /api/scenarios/production-conditions/route.ts exactly in shape and
 * safeguards (rate limit, server-side flag re-check, hard-fail on a
 * persistence error) — see that route's own comments for the reasoning
 * behind each; only the domain-specific pieces (which table to read, how
 * the request identifies "which group", the resolution horizon) differ.
 *
 * The request identifies one reconciled group the same way
 * CommodityPricesCard.tsx's own React key does — (commodity, priceType,
 * unit, currency, region) — rather than "commodity" alone, because unlike
 * production_conditions (always region="National", one figure per
 * commodity+metric+year), a commodity here can legitimately have more than
 * one group (e.g. AFEX's exchange-spot price alongside NBS/World Bank
 * RTFP's retail price for the same crop) that must never be modeled
 * together — see reconcileCommodityPrices' own grouping key for why.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RATE_LIMIT = { limit: 5, windowMs: 10 * 60_000 };

const PRICE_TYPES: readonly PriceType[] = ["retail", "wholesale", "exchange_spot", "farmgate"];

const RequestSchema = z.object({
  commodity: z.string().min(1).max(200),
  priceType: z.enum(PRICE_TYPES as [PriceType, ...PriceType[]]),
  unit: z.string().min(1).max(100),
  currency: z.string().min(1).max(10),
  region: z.string().min(1).max(200),
});

interface ObservationRow {
  id: number;
  commodity: string;
  source: string;
  price_type: string;
  value: number;
  unit: string;
  currency: string;
  period_date: string;
  region: string;
  raw_item_label: string | null;
}

export async function POST(req: NextRequest) {
  const clientKey = getClientKey(req);
  const rl = checkRateLimit(`scenarios:commodity-prices:${clientKey}`, RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many scenario requests. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil((rl.resetAt - Date.now()) / 1000).toString() },
      }
    );
  }

  const enabled = await isFeatureEnabled("commodity_prices_scenarios");
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
  const { commodity, priceType, unit, currency, region } = parsed.data;

  const supabase = getSupabaseBrowserClient();
  const [observationsRes, manualRes] = await Promise.all([
    supabase
      .from("commodity_price_observations")
      .select("id, commodity, source, price_type, value, unit, currency, period_date, region, raw_item_label")
      .eq("commodity", commodity)
      .eq("price_type", priceType)
      .eq("unit", unit)
      .eq("currency", currency)
      .eq("region", region)
      .order("period_date", { ascending: false })
      .limit(40),
    supabase
      .from("manual_data_entries")
      .select("entry_date, payload")
      .eq("domain", "commodity_prices")
      .eq("status", "published"),
  ]);

  if (observationsRes.error || manualRes.error) {
    console.error(
      "[scenarios/commodity-prices] query failed:",
      observationsRes.error ?? manualRes.error
    );
    return NextResponse.json({ error: "Could not load commodity price data." }, { status: 500 });
  }

  const automated = (observationsRes.data as ObservationRow[]) ?? [];
  const manual: NormalizedPriceObservation[] = (
    (manualRes.data as { entry_date: string; payload: CommodityPriceEntryPayload }[]) ?? []
  )
    .map((entry) => normalizeManualCommodityEntry({ entryDate: entry.entry_date, payload: entry.payload }))
    .filter(
      (obs) =>
        obs.commodity === commodity &&
        obs.priceType === priceType &&
        obs.unit === unit &&
        obs.currency === currency &&
        obs.region === region
    );

  const automatedNormalized: NormalizedPriceObservation[] = automated.map((row) => ({
    commodity: row.commodity,
    source: row.source,
    priceType: row.price_type as PriceType,
    value: row.value,
    unit: row.unit,
    currency: row.currency,
    periodDate: row.period_date,
    region: row.region,
    rawItemLabel: row.raw_item_label,
  }));

  const observations = [...automatedNormalized, ...manual];
  if (observations.length === 0) {
    return NextResponse.json(
      {
        error: `No price data for "${commodity}" (${priceType}, ${unit}, ${region}) yet — nothing to model scenarios from.`,
      },
      { status: 404 }
    );
  }

  const compactTelemetry = buildCompactPriceTelemetry(observations);
  const mostRecentAutomated = automated[0]; // already ordered period_date desc
  const horizon = getCommodityPricesResolutionHorizon(new Date());

  const input: ScenarioGenerationInput = {
    domain: "commodity_price_observations",
    commodity,
    agricultureType: getCropCategory(commodity) === "Livestock products" ? "livestock" : "crop",
    region,
    compactTelemetry,
    resolutionHorizonDescription: horizon.description,
  };

  let scenario;
  try {
    scenario = await generateScenario(input);
  } catch (err) {
    console.error("[scenarios/commodity-prices] AI generation failed:", err);
    return NextResponse.json(
      { error: "Scenario modeling is temporarily unavailable. Please try again shortly." },
      { status: 502 }
    );
  }

  const admin = getSupabaseAdminClient();
  const { error: insertError } = await admin.from("scenario_predictions").insert(
    scenario.branches.map((branch) => ({
      signal_source_table: "commodity_price_observations",
      signal_source_id: mostRecentAutomated?.id ?? null,
      commodity,
      region,
      agriculture_type: input.agricultureType,
      branch: branch.branch,
      narrative: branch.narrative,
      predicted_range_low: branch.predicted_range_low,
      predicted_range_high: branch.predicted_range_high,
      unit: branch.unit,
      confidence_label: branch.confidence_label,
      force_majeure_caveat: branch.force_majeure_caveat,
      target_resolution_date: horizon.targetResolutionDate,
      resolution_metric: `Reconciled ${priceType} price for ${commodity} (${unit}, ${region}), ${horizon.description}`,
    }))
  );

  if (insertError) {
    console.error("[scenarios/commodity-prices] persisting scenario_predictions failed:", insertError);
    return NextResponse.json(
      { error: "Scenario was generated but could not be recorded. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json(scenario);
}
