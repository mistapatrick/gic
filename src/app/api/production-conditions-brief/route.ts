import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { withAiFallback } from "@/lib/ai-models";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  ProductionBriefSchema,
  buildCompactProductionTelemetry,
  buildProductionBriefPrompt,
  type ProductionBriefRow,
} from "@/lib/domains/production-conditions/brief-logic";

/**
 * AI synthesis for the production_conditions public card. Cached for an
 * hour (`revalidate`) rather than generated per visitor: production_conditions
 * only changes via an occasional FAOSTAT cron run or a super-admin CSV
 * upload, so an hourly refresh is already far more current than the data
 * itself usually is, and it keeps Gemini free-tier usage bounded regardless
 * of traffic (see src/lib/ai-models.ts on why the free tier's daily request
 * budget matters here). This route takes no request input and reads only
 * already-public data (the same anon-key, RLS-public-read client the card
 * itself uses — see src/app/api/brief-card/[slug]/route.tsx for the same
 * pattern), so it carries no more exposure than the card it's summarizing.
 */
export const revalidate = 3600;

const NO_DATA_SUMMARY = "No production data has been ingested yet.";
const AI_UNAVAILABLE_SUMMARY =
  "Production figures are available below, but the AI synthesis step did not complete for this request.";

export async function GET() {
  // Constructing the client throws synchronously if the anon-key env vars
  // are missing (see src/lib/supabase/client.ts) — caught here, the same
  // defensive way isFeatureEnabled() treats the same throw, rather than
  // left to propagate. Besides a genuinely misconfigured deployment, this
  // also matters for `next build`'s static-generation pass: with
  // `revalidate` set and no `dynamic` override, Next executes this handler
  // once at build time to seed its cache, and a build environment may not
  // carry real Supabase credentials the way the Vercel runtime does.
  let data: ProductionBriefRow[] | null = null;
  try {
    const supabase = getSupabaseBrowserClient();
    const result = await supabase
      .from("production_conditions")
      .select("commodity, metric, value, unit, year")
      .eq("region", "National")
      .in("metric", [
        "production_quantity",
        "yield",
        "area_harvested",
        "stocks",
        "producing_animals_slaughtered",
      ])
      .order("year", { ascending: false });

    if (result.error) {
      console.error("[production-conditions-brief] query failed:", result.error);
      return NextResponse.json({ error: "Could not load production conditions data." }, { status: 500 });
    }
    data = result.data as ProductionBriefRow[];
  } catch (err) {
    console.error("[production-conditions-brief] Supabase client unavailable:", err);
    return NextResponse.json({ national_summary: NO_DATA_SUMMARY, standout_insights: [] });
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ national_summary: NO_DATA_SUMMARY, standout_insights: [] });
  }

  const compactTelemetry = buildCompactProductionTelemetry(rows);

  try {
    const result = await withAiFallback((model) =>
      generateObject({
        model,
        schema: ProductionBriefSchema,
        prompt: buildProductionBriefPrompt(compactTelemetry),
        abortSignal: AbortSignal.timeout(40_000),
      })
    );
    return NextResponse.json(result.object);
  } catch (err) {
    // Degrade gracefully, same as the weather ingest route: the per-commodity
    // figures are already rendered by the card regardless of this synthesis
    // succeeding, so a Gemini outage shouldn't blank the whole card.
    console.error("[production-conditions-brief] AI synthesis failed:", err);
    return NextResponse.json({ national_summary: AI_UNAVAILABLE_SUMMARY, standout_insights: [] });
  }
}
