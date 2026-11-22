"use client";

import React, { useMemo, useState } from "react";
import { Download, ChevronDown } from "lucide-react";

type ExportType = "hourly" | "daily";
type ExportFormat = "csv" | "xlsx";

function isoDaysBefore(fromIso: string, days: number): string {
  const d = new Date(`${fromIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * "Export data" disclosure panel: lets whoever's looking at the dashboard
 * pull observed telemetry out as a CSV or XLSX file for a date range they
 * choose, either as hourly raw readings or daily per-cluster summaries.
 * A plain <a href> (not a fetch+blob) so the browser handles the download
 * natively — same pattern as the existing "Download briefing card" link.
 * The actual query validation/bounding happens server-side in
 * /api/export (see src/lib/export-logic.ts); this panel's min/max/defaults
 * are a UX nicety, not the source of truth.
 */
export function ExportPanel({ latestObsDate }: { latestObsDate: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<ExportType>("hourly");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [start, setStart] = useState(() => isoDaysBefore(latestObsDate, 6));
  const [end, setEnd] = useState(latestObsDate);

  const href = useMemo(() => {
    const params = new URLSearchParams({ type, format, start, end });
    return `/api/export?${params.toString()}`;
  }, [type, format, start, end]);

  const rangeInvalid = start > end;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-teal/30 bg-brand-white px-3 py-2 text-xs font-semibold text-brand-teal hover:bg-brand-teal-soft"
        aria-expanded={isOpen}
      >
        <Download className="h-3.5 w-3.5" />
        Export data
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-xl border border-brand-grey-green bg-brand-white p-3 shadow-lg">
          <div className="space-y-2.5">
            <div>
              <span className="mb-1 block text-[11px] font-semibold text-brand-ink-soft">Data</span>
              <div className="flex gap-1.5">
                <ToggleButton active={type === "hourly"} onClick={() => setType("hourly")}>
                  Hourly readings
                </ToggleButton>
                <ToggleButton active={type === "daily"} onClick={() => setType("daily")}>
                  Daily summaries
                </ToggleButton>
              </div>
            </div>

            <div>
              <span className="mb-1 block text-[11px] font-semibold text-brand-ink-soft">Format</span>
              <div className="flex gap-1.5">
                <ToggleButton active={format === "csv"} onClick={() => setFormat("csv")}>
                  CSV
                </ToggleButton>
                <ToggleButton active={format === "xlsx"} onClick={() => setFormat("xlsx")}>
                  Excel (.xlsx)
                </ToggleButton>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] font-semibold text-brand-ink-soft">
                From
                <input
                  type="date"
                  value={start}
                  max={end}
                  onChange={(e) => setStart(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-brand-grey-green bg-brand-white px-2 py-1.5 text-xs text-brand-ink"
                />
              </label>
              <label className="text-[11px] font-semibold text-brand-ink-soft">
                To
                <input
                  type="date"
                  value={end}
                  min={start}
                  max={latestObsDate}
                  onChange={(e) => setEnd(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-brand-grey-green bg-brand-white px-2 py-1.5 text-xs text-brand-ink"
                />
              </label>
            </div>

            {rangeInvalid ? (
              <p className="text-[11px] text-metric-max-temp">
                &quot;From&quot; must be on or before &quot;To&quot;.
              </p>
            ) : (
              <a
                href={href}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-brand-teal px-3 py-2 text-xs font-semibold text-brand-white hover:bg-brand-teal-dark"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            )}

            <p className="text-[10px] leading-relaxed text-brand-muted">
              Hourly exports: up to 92 days per download. Daily summaries: up to 366 days.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition ${
        active
          ? "bg-brand-teal text-brand-white"
          : "bg-brand-grey-green text-brand-ink-soft hover:bg-brand-mint-pale"
      }`}
    >
      {children}
    </button>
  );
}
