import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { withAiFallback } from "@/lib/ai-models";
import { z } from "zod";
import { getServerEnv } from "@/lib/env.server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedBearer } from "@/lib/auth/cron-auth";
import {
  buildAiPrompt,
  buildCompactTelemetry,
  buildOpenMeteoUrl,
  getCutoffHour,
  getLagosDateParts,
  OpenMeteoResponseSchema,
  parseIngestionResults,
  type ClusterRow,
} from "@/lib/domains/weather/ingest-logic";

// Vercel Hobby plan supports function durations up to 60s on this route.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const AgentReportSchema = z.object({
  national_summary: z
    .string()
    .describe(
      "Concise 3-sentence factual synthesis of experienced/observed weather across all 24 clusters today. No speculation about tomorrow."
    ),
  regional_insights: z.array(
    z.object({
      geo_zone: z.string(),
      headline: z.string(),
      observed_anomaly: z.string(),
      agronomic_implication: z.string(),
    })
  ),
});

export async function POST(req: NextRequest) {
  let env;
  try {
    env = getServerEnv();
  } catch (err) {
    // Misconfiguration, not a client error — log details server-side only.
    console.error("[ingest] environment misconfigured:", err);
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (!isAuthorizedBearer(req.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdminClient();

  // 1. Current date & elapsed hour in Africa/Lagos (GMT+1, no DST).
  const { obsDate, currentHour } = getLagosDateParts();
  const cutoffHour = getCutoffHour(currentHour);

  // 2. Fetch all 24 clusters from Supabase.
  const { data: clusters, error: clusterErr } = await supabaseAdmin
    .from("weather_clusters")
    .select("*")
    .order("id", { ascending: true });

  if (clusterErr || !clusters || clusters.length === 0) {
    console.error("[ingest] cluster query failed:", clusterErr);
    return NextResponse.json({ error: "Cluster query failed" }, { status: 500 });
  }

  // 3. Single batched Open-Meteo request. forecast_days=1 is needed just to
  //    get today's date back from the API at all; "strictly observed, never
  //    forecast" is enforced below by the hour-cutoff filter, not by this flag.
  const url = buildOpenMeteoUrl(clusters as ClusterRow[]);
  let omRes: Response;
  try {
    omRes = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    console.error("[ingest] Open-Meteo request failed:", err);
    return NextResponse.json({ error: "Open-Meteo fetch failed" }, { status: 502 });
  }
  if (!omRes.ok) {
    return NextResponse.json({ error: "Open-Meteo fetch failed" }, { status: 502 });
  }

  const rawOmData: unknown = await omRes.json();
  const omParsed = OpenMeteoResponseSchema.safeParse(rawOmData);
  if (!omParsed.success) {
    console.error("[ingest] Open-Meteo response failed validation:", omParsed.error.message);
    return NextResponse.json({ error: "Open-Meteo response shape unexpected" }, { status: 502 });
  }

  // 4. Filter strictly to obsDate hours 00:00..cutoffHour (experienced/observed only).
  const { hourlyRows, clusterMetrics } = parseIngestionResults(
    omParsed.data,
    clusters as ClusterRow[],
    obsDate,
    cutoffHour
  );

  if (hourlyRows.length === 0) {
    return NextResponse.json(
      { error: "No elapsed observation hours to ingest yet for this date" },
      { status: 422 }
    );
  }

  // 5. Idempotent upsert of hourly observations. `onConflict` on the unique
  //    (cluster_id, obs_date, obs_hour) key means re-running this job for the
  //    same night (a retried GitHub Actions run, a manual backfill) overwrites
  //    the same rows instead of creating duplicates or erroring.
  const { error: upsertErr } = await supabaseAdmin
    .from("observed_hourly")
    .upsert(hourlyRows, { onConflict: "cluster_id,obs_date,obs_hour" });

  if (upsertErr) {
    console.error("[ingest] hourly upsert failed:", upsertErr);
    return NextResponse.json({ error: "Database write failed" }, { status: 500 });
  }

  // 6. Generate a grounded observational summary via the free three-leg AI
  //    fallback chain (primary gemini-3.5-flash-lite, then gemini-3.1-flash-lite,
  //    then Groq's gpt-oss-120b, each attempted only after the previous one
  //    fails retryably — see src/lib/ai-models.ts for why Flash-Lite, not
  //    plain Flash, and why Groq's gpt-oss-120b, are the free-tier-appropriate
  //    choices here).
  const compactTelemetry = buildCompactTelemetry(clusterMetrics);
  let aiBrief: z.infer<typeof AgentReportSchema>;
  try {
    const result = await withAiFallback((model) =>
      generateObject({
        model,
        schema: AgentReportSchema,
        prompt: buildAiPrompt(obsDate, cutoffHour, compactTelemetry),
        abortSignal: AbortSignal.timeout(40_000),
      })
    );
    aiBrief = result.object;
  } catch (err) {
    console.error("[ingest] AI synthesis failed:", err);
    // Degrade gracefully: the raw telemetry has already been saved above, so
    // the dashboard's charts still update even if the AI brief fails for the
    // night. Save a neutral placeholder summary rather than losing the run.
    aiBrief = {
      national_summary:
        "Observed telemetry for all 24 clusters was ingested successfully, but the AI synthesis step did not complete for this run.",
      regional_insights: [],
    };
  }

  // 7. Save the daily report (also upsert — same idempotency guarantee).
  const { error: reportErr } = await supabaseAdmin.from("daily_observed_reports").upsert(
    {
      obs_date: obsDate,
      cutoff_hour_wat: cutoffHour,
      national_summary: aiBrief.national_summary,
      regional_insights: aiBrief.regional_insights,
      cluster_metrics: clusterMetrics,
    },
    { onConflict: "obs_date" }
  );

  if (reportErr) {
    console.error("[ingest] report upsert failed:", reportErr);
    return NextResponse.json({ error: "Database write failed" }, { status: 500 });
  }

  return NextResponse.json({
    status: "success",
    obs_date: obsDate,
    hours_ingested_per_cluster: cutoffHour + 1,
    clusters_processed: clusterMetrics.length,
  });
}
