import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { MIN_COMPLETE_CUTOFF_HOUR } from "@/lib/domains/weather/ingest-logic";
import type { ClusterMetrics, DailyObservedReport, RiskFlagSeverity } from "@/lib/types";

/**
 * Per-cluster branded briefing card — a 1200x630 PNG a Growthly staffer can
 * drop straight into a bid, a program report, or a client email, built
 * entirely from `next/og`'s ImageResponse (bundled with Next.js, no extra
 * dependency, zero added infrastructure on Vercel's free tier).
 *
 * This route only ever reads already-public data (the same anon-key,
 * RLS-public-read client the dashboard itself uses — see
 * supabase/schema.sql), so it carries no more exposure than the dashboard
 * page it's rendering a snapshot of.
 */
export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<RiskFlagSeverity, { text: string; bg: string }> = {
  alert: { text: "#b3312f", bg: "#fbe9e7" },
  watch: { text: "#8a5a00", bg: "#fdf0dc" },
  info: { text: "#005a5a", bg: "#d4f6e5" },
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dateParam = req.nextUrl.searchParams.get("date");

  const supabase = getSupabaseBrowserClient();
  let query = supabase.from("daily_observed_reports").select("*").order("obs_date", { ascending: false }).limit(1);
  if (dateParam) {
    query = supabase.from("daily_observed_reports").select("*").eq("obs_date", dateParam).limit(1);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) {
    return NextResponse.json({ error: "No observational report found" }, { status: 404 });
  }

  const report = data as DailyObservedReport;
  const cluster = report.cluster_metrics.find((c) => c.slug === slug) as ClusterMetrics | undefined;
  if (!cluster) {
    return NextResponse.json({ error: `No data for cluster "${slug}" on ${report.obs_date}` }, { status: 404 });
  }

  const metrics: Array<{ label: string; value: string }> = [
    { label: "Rainfall", value: `${cluster.total_precip_mm} mm` },
    { label: "Avg Humidity", value: `${cluster.avg_humidity_pct}%` },
    { label: "Avg Wind", value: `${cluster.avg_wind_kmh} km/h` },
    { label: "Avg Temp", value: `${cluster.avg_temp_c}°C` },
    { label: "Max / Min Temp", value: `${cluster.max_temp_c}°C / ${cluster.min_temp_c}°C` },
    { label: "Sunshine", value: `${cluster.total_sunshine_hrs} hrs` },
  ];

  return new ImageResponse(
    (
      <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              backgroundColor: "#ffffff",
              fontFamily: "sans-serif",
              padding: 48,
            }}
          >
            {/* Header: brand mark + product name */}
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  backgroundColor: "#005a5a",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    backgroundColor: "#93e9be",
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 30, fontWeight: 800, color: "#005a5a" }}>GIC</span>
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: "#005a5a",
                      backgroundColor: "#93e9be",
                      borderRadius: 6,
                      padding: "2px 8px",
                    }}
                  >
                    NG
                  </span>
                </div>
                <span style={{ fontSize: 14, color: "#3f5c5c" }}>
                  A Growthly Nexus Solutions Limited data product
                </span>
              </div>
            </div>

            {/* Cluster identity + date */}
            <div style={{ display: "flex", flexDirection: "column", marginTop: 32 }}>
              <span style={{ fontSize: 42, fontWeight: 800, color: "#0b2b2b" }}>
                {cluster.state_label} — {cluster.cluster_name}
              </span>
              <span style={{ fontSize: 18, color: "#3f5c5c", marginTop: 4 }}>
                {cluster.geo_zone} Zone • Observed telemetry for {report.obs_date}, through{" "}
                {String(report.cutoff_hour_wat).padStart(2, "0")}:00 WAT
              </span>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  marginTop: 8,
                  alignSelf: "flex-start",
                  color: report.cutoff_hour_wat >= MIN_COMPLETE_CUTOFF_HOUR ? "#005a5a" : "#8a5a00",
                  backgroundColor: report.cutoff_hour_wat >= MIN_COMPLETE_CUTOFF_HOUR ? "#d4f6e5" : "#fdf0dc",
                  borderRadius: 14,
                  padding: "4px 12px",
                }}
              >
                {report.cutoff_hour_wat >= MIN_COMPLETE_CUTOFF_HOUR
                  ? "Full day reporting period"
                  : "Partial day — ingestion was still in progress at this cutoff"}
              </span>
            </div>

            {/* Metrics grid */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 28 }}>
              {metrics.map((m) => (
                <div
                  key={m.label}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    backgroundColor: "#e0ebeb",
                    borderRadius: 12,
                    padding: "14px 20px",
                    minWidth: 170,
                  }}
                >
                  <span style={{ fontSize: 14, color: "#3f5c5c", fontWeight: 600 }}>{m.label}</span>
                  <span style={{ fontSize: 26, color: "#0b2b2b", fontWeight: 800 }}>{m.value}</span>
                </div>
              ))}
            </div>

            {/* Risk flags — deterministic, computed by rule (see ingest-logic.ts) */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 24 }}>
              {cluster.risk_flags.length > 0 ? (
                cluster.risk_flags.map((flag) => {
                  const color = STATUS_COLOR[flag.severity];
                  return (
                    <span
                      key={flag.code}
                      style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: color.text,
                        backgroundColor: color.bg,
                        borderRadius: 20,
                        padding: "8px 16px",
                      }}
                    >
                      {flag.label}
                    </span>
                  );
                })
              ) : (
                <span style={{ fontSize: 16, color: "#3f5c5c" }}>No agronomic risk flags today.</span>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                display: "flex",
                marginTop: "auto",
                paddingTop: 24,
                borderTop: "2px solid #e0ebeb",
                fontSize: 14,
                color: "#6b8484",
              }}
            >
              growthlysolutions.com • Observed data, not a forecast • Prepared by Growthly Nexus Solutions Limited
            </div>
          </div>
    ),
    { width: 1200, height: 630 }
  );
}
