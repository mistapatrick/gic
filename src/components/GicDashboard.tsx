"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  Play,
  Pause,
  RotateCcw,
  MapPin,
  CloudRain,
  Droplets,
  Wind,
  Thermometer,
  Sun,
  AlertTriangle,
  AlertCircle,
  Info,
  ImageDown,
} from "lucide-react";
import { GicLogo } from "./GicLogo";
import { AgentBriefPanel } from "./AgentBriefPanel";
import { ExportPanel } from "./ExportPanel";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { GEO_ZONES, type ClusterMetrics, type DailyObservedReport, type RiskFlagSeverity } from "@/lib/types";

// Status styling for deterministic agronomic risk flags — see
// computeRiskFlags() in lib/ingest-logic.ts. Reserved status colors only;
// never reused as a chart series color (dataviz skill's status-color rule).
// Each badge pairs an icon with its text label, so severity is never carried
// by color alone.
const FLAG_STYLE: Record<RiskFlagSeverity, { bg: string; text: string; Icon: typeof Info }> = {
  alert: { bg: "bg-status-alert-bg", text: "text-status-alert", Icon: AlertTriangle },
  watch: { bg: "bg-status-watch-bg", text: "text-status-watch", Icon: AlertCircle },
  info: { bg: "bg-status-info-bg", text: "text-status-info", Icon: Info },
};

// Growthly Nexus Solutions brand chart-ink — matches the CSS custom
// properties declared in globals.css. Kept here as plain hex because
// Recharts' stroke/fill props need literal color strings, not Tailwind
// classes. Chosen from the dataviz skill's validated categorical palette
// (see globals.css header comment) rather than invented ad hoc.
const CHART = {
  grid: "#e0ebeb",
  axis: "#6b8484",
  tooltipBg: "#ffffff",
  tooltipBorder: "#d4f6e5",
  rainfall: "#2a78d6",
  rainfallSoft: "#86b6ef",
  humidity: "#1baf7a",
  wind: "#6250d6",
  avgTemp: "#eda100",
  maxTemp: "#e34948",
  minTemp: "#e87ba4",
  sunshine: "#eb6834",
  sunshineSoft: "#d95926",
};

const tooltipStyle = {
  backgroundColor: CHART.tooltipBg,
  borderColor: CHART.tooltipBorder,
  fontSize: 12,
};

export default function GicDashboard({
  initialReport,
}: {
  initialReport: DailyObservedReport | null;
}) {
  const [report, setReport] = useState<DailyObservedReport | null>(initialReport);
  const [selectedSlug, setSelectedSlug] = useState<string>(
    initialReport?.cluster_metrics?.[0]?.slug ?? "anambra-ayamelum"
  );
  const [selectedZone, setSelectedZone] = useState<string>("ALL");
  const [activeHour, setActiveHour] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);

  const maxHour = report?.cutoff_hour_wat ?? 23;

  // Live Supabase Realtime subscription for automatic 23:59 WAT refresh.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("growthly-gic-live-report")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_observed_reports" },
        (payload) => {
          if (payload.new) {
            setReport(payload.new as DailyObservedReport);
            setActiveHour(0);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Continuous diurnal animation loop (00:00 -> cutoff hour WAT).
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setActiveHour((prev) => (prev >= maxHour ? 0 : prev + 1));
    }, 850);
    return () => clearInterval(interval);
  }, [isPlaying, maxHour]);

  const clusters = useMemo<ClusterMetrics[]>(() => {
    if (!report?.cluster_metrics) return [];
    if (selectedZone === "ALL") return report.cluster_metrics;
    return report.cluster_metrics.filter((c) => c.geo_zone === selectedZone);
  }, [report, selectedZone]);

  // Derived rather than effect-synced: if the selected slug isn't in the
  // current zone filter (e.g. the user just switched zones), fall back to
  // the first cluster in that zone for rendering, without needing a
  // render -> effect -> setState -> render round trip.
  const effectiveSlug = useMemo(() => {
    if (clusters.some((c) => c.slug === selectedSlug)) return selectedSlug;
    return clusters[0]?.slug ?? selectedSlug;
  }, [clusters, selectedSlug]);

  const activeCluster = useMemo(() => {
    return (
      clusters.find((c) => c.slug === effectiveSlug) ?? report?.cluster_metrics?.[0] ?? null
    );
  }, [clusters, effectiveSlug, report]);

  // Progressive time-series sliced up to activeHour for smooth animation.
  const animatedSeries = useMemo(() => {
    if (!activeCluster?.hourly) return [];
    return activeCluster.hourly.filter((h) => h.obs_hour <= activeHour);
  }, [activeCluster, activeHour]);

  const currentPoint = animatedSeries[animatedSeries.length - 1];

  if (!report || !activeCluster) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-brand-white p-6 text-center">
        <GicLogo className="mb-4" />
        <p className="text-sm text-brand-ink-soft">
          Awaiting initial 23:59 WAT observational telemetry run...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-white text-brand-ink">
      {/* Top sticky responsive navbar */}
      <header className="sticky top-0 z-30 border-b border-brand-grey-green bg-brand-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <GicLogo />

          <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
            <span className="rounded-full border border-brand-teal/30 bg-brand-mint-pale px-3 py-1 text-xs font-semibold text-brand-teal">
              {report.obs_date} • {String(activeHour).padStart(2, "0")}:00 WAT
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsPlaying(!isPlaying)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-3 py-1.5 text-xs font-medium text-brand-white hover:bg-brand-teal-dark"
              >
                {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {isPlaying ? "Pause" : "Play"}
              </button>
              <button
                type="button"
                onClick={() => setActiveHour(0)}
                aria-label="Restart animation"
                className="rounded-lg border border-brand-grey-green bg-brand-white p-1.5 text-brand-ink-soft hover:bg-brand-mint-pale"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Full-width scrubber bar */}
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 pb-2.5 lg:px-8">
          <span className="font-mono text-[11px] text-brand-ink-soft">00:00</span>
          <input
            type="range"
            min={0}
            max={maxHour}
            value={activeHour}
            onChange={(e) => {
              setIsPlaying(false);
              setActiveHour(Number(e.target.value));
            }}
            className="h-1.5 w-full cursor-pointer accent-brand-teal"
          />
          <span className="font-mono text-[11px] text-brand-ink-soft">{maxHour}:00</span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 lg:px-8">
        {/* Location & geo-zone selector */}
        <section className="rounded-xl border border-brand-grey-green bg-brand-mint-pale/40 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0 text-brand-teal" />
              <div>
                <h1 className="text-base font-bold text-brand-ink sm:text-lg">
                  {activeCluster.state_label} — {activeCluster.cluster_name}
                </h1>
                <p className="text-xs text-brand-ink-soft">
                  {activeCluster.geo_zone} Zone • Lat {activeCluster.latitude.toFixed(2)}°N, Lon{" "}
                  {activeCluster.longitude.toFixed(2)}°E
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <a
                href={`/api/brief-card/${activeCluster.slug}?date=${report.obs_date}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-teal/30 bg-brand-white px-3 py-2 text-xs font-semibold text-brand-teal hover:bg-brand-teal-soft"
              >
                <ImageDown className="h-3.5 w-3.5" />
                Download briefing card
              </a>
              <ExportPanel latestObsDate={report.obs_date} />
              <select
                value={selectedZone}
                onChange={(e) => setSelectedZone(e.target.value)}
                className="rounded-lg border border-brand-grey-green bg-brand-white px-3 py-2 text-xs font-medium text-brand-ink"
              >
                <option value="ALL">All Zones (24 Clusters)</option>
                {GEO_ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z} (4)
                  </option>
                ))}
              </select>
              <select
                value={effectiveSlug}
                onChange={(e) => setSelectedSlug(e.target.value)}
                className="rounded-lg border border-brand-teal/40 bg-brand-white px-3 py-2 text-xs font-semibold text-brand-teal"
              >
                {clusters.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.state_label} ({c.cluster_name})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Deterministic agronomic risk flags for the selected cluster —
              computed by rule, not by the AI, so they're exact enough to cite
              in a client briefing or bid. */}
          {activeCluster.risk_flags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {activeCluster.risk_flags.map((flag) => {
                const style = FLAG_STYLE[flag.severity];
                return (
                  <span
                    key={flag.code}
                    title={flag.detail}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${style.bg} ${style.text}`}
                  >
                    <style.Icon className="h-3 w-3" />
                    {flag.label}
                  </span>
                );
              })}
            </div>
          )}

          {/* Horizontal touch-friendly cluster pills for mobile & tablet */}
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {clusters.map((c) => {
              const active = c.slug === effectiveSlug;
              return (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => setSelectedSlug(c.slug)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                    active
                      ? "bg-brand-teal text-brand-white shadow"
                      : "bg-brand-grey-green text-brand-ink-soft hover:bg-brand-mint-pale"
                  }`}
                >
                  {c.state_label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Live animated KPI strip (7 metrics at current animated hour) */}
        <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
          <KpiCard
            icon={<CloudRain className="h-4 w-4" style={{ color: CHART.rainfall }} />}
            label="Rainfall (Cum.)"
            value={`${currentPoint?.cum_precip_mm ?? 0} mm`}
          />
          <KpiCard
            icon={<Droplets className="h-4 w-4" style={{ color: CHART.humidity }} />}
            label="Humidity"
            value={`${currentPoint?.rel_humidity_pct ?? 0}%`}
          />
          <KpiCard
            icon={<Wind className="h-4 w-4" style={{ color: CHART.wind }} />}
            label="Wind Speed"
            value={`${currentPoint?.wind_speed_kmh ?? 0} km/h`}
          />
          <KpiCard
            icon={<Thermometer className="h-4 w-4" style={{ color: CHART.avgTemp }} />}
            label="Avg Temp"
            value={`${currentPoint?.avg_temp_c ?? 0}°C`}
          />
          <KpiCard
            icon={<Thermometer className="h-4 w-4" style={{ color: CHART.maxTemp }} />}
            label="Max Temp"
            value={`${currentPoint?.max_temp_c ?? 0}°C`}
          />
          <KpiCard
            icon={<Thermometer className="h-4 w-4" style={{ color: CHART.minTemp }} />}
            label="Min Temp"
            value={`${currentPoint?.min_temp_c ?? 0}°C`}
          />
          <KpiCard
            icon={<Sun className="h-4 w-4" style={{ color: CHART.sunshine }} />}
            label="Sunshine (Cum.)"
            value={`${currentPoint?.cum_sunshine_hrs ?? 0} hrs`}
          />
        </section>

        {/* 7 location-specific animated graphs */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <ChartCard title="1. Observed Rainfall (mm)" subtitle="Hourly & Cumulative Precipitation">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={animatedSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis dataKey="label" tick={{ fill: CHART.axis, fontSize: 10 }} />
                <YAxis tick={{ fill: CHART.axis, fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="cum_precip_mm" name="Cumulative Rain (mm)" fill={CHART.rainfallSoft} radius={[3, 3, 0, 0]} isAnimationActive />
                <Bar dataKey="precip_mm" name="Hourly Rain (mm)" fill={CHART.rainfall} radius={[3, 3, 0, 0]} isAnimationActive />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="2. Humidity (%)" subtitle="Observed Relative Humidity">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={animatedSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis dataKey="label" tick={{ fill: CHART.axis, fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fill: CHART.axis, fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="rel_humidity_pct" name="Humidity (%)" stroke={CHART.humidity} fill={CHART.humidity} fillOpacity={0.18} isAnimationActive />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="3. Wind Speed (km/h)" subtitle="Observed 10m Surface Wind">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={animatedSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis dataKey="label" tick={{ fill: CHART.axis, fontSize: 10 }} />
                <YAxis tick={{ fill: CHART.axis, fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="wind_speed_kmh" name="Wind (km/h)" stroke={CHART.wind} strokeWidth={2} dot={false} isAnimationActive />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="4. Avg Temp (°C)" subtitle="Cumulative Observed Mean Temperature">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={animatedSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis dataKey="label" tick={{ fill: CHART.axis, fontSize: 10 }} />
                <YAxis domain={["auto", "auto"]} tick={{ fill: CHART.axis, fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="avg_temp_c" name="Running Avg (°C)" stroke={CHART.avgTemp} strokeWidth={2} dot={false} isAnimationActive />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="5. Max Temp (°C)" subtitle="Observed Diurnal Peak Progression">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={animatedSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis dataKey="label" tick={{ fill: CHART.axis, fontSize: 10 }} />
                <YAxis domain={["auto", "auto"]} tick={{ fill: CHART.axis, fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="max_temp_c" name="Observed Max (°C)" stroke={CHART.maxTemp} fill={CHART.maxTemp} fillOpacity={0.16} isAnimationActive />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="6. Min Temp (°C)" subtitle="Observed Diurnal Floor Progression">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={animatedSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis dataKey="label" tick={{ fill: CHART.axis, fontSize: 10 }} />
                <YAxis domain={["auto", "auto"]} tick={{ fill: CHART.axis, fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="min_temp_c" name="Observed Min (°C)" stroke={CHART.minTemp} fill={CHART.minTemp} fillOpacity={0.16} isAnimationActive />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="md:col-span-2 xl:col-span-3">
            <ChartCard title="7. Sunshine (hrs)" subtitle="Observed Hourly & Cumulative Bright Sunshine Duration">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={animatedSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                  <XAxis dataKey="label" tick={{ fill: CHART.axis, fontSize: 10 }} />
                  <YAxis tick={{ fill: CHART.axis, fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="cum_sunshine_hrs" name="Cumulative Sunshine (hrs)" fill={CHART.sunshineSoft} radius={[3, 3, 0, 0]} isAnimationActive />
                  <Bar dataKey="sunshine_hrs" name="Hourly Sunshine (hrs)" fill={CHART.sunshine} radius={[3, 3, 0, 0]} isAnimationActive />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </section>

        <AgentBriefPanel report={report} />
      </main>
    </div>
  );
}

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-brand-grey-green bg-brand-white p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-brand-ink-soft">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-base font-bold text-brand-ink sm:text-lg">{value}</div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-brand-grey-green bg-brand-white p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-brand-ink">{title}</h3>
        <p className="text-[11px] text-brand-ink-soft">{subtitle}</p>
      </div>
      <div className="h-52 w-full sm:h-60">{children}</div>
    </div>
  );
}
