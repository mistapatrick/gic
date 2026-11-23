"use client";

import { useRef, useState } from "react";

interface BackfillJobState {
  domain: string;
  rangeStart: string;
  rangeEnd: string;
  cursorDate: string;
  chunkSizeDays: number;
  status: "pending" | "running" | "completed" | "failed";
  rowsWritten: number;
  lastError: string | null;
}

/**
 * Super-admin UI for the historical-backfill provision
 * (src/lib/ingestion/backfill-framework.ts). One POST to /api/admin/backfill
 * runs one time-boxed "tick" (as many date-chunks as fit in ~45s) and
 * returns the job's updated status; this panel just keeps calling it with
 * "Run until done," which is the browser-side version of what a scheduled
 * script would otherwise do. Safe to stop and resume any time — progress
 * is persisted server-side after every chunk, not just when this tab is
 * open.
 */
export function BackfillPanel({ domains }: { domains: string[] }) {
  const [domain, setDomain] = useState(domains[0] ?? "weather");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [job, setJob] = useState<BackfillJobState | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRequested = useRef(false);

  async function tick(): Promise<BackfillJobState | null> {
    const res = await fetch("/api/admin/backfill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, rangeStart, rangeEnd }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "Backfill request failed");
      return null;
    }
    setJob(body.job);
    return body.job as BackfillJobState;
  }

  async function handleRunUntilDone(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRunning(true);
    stopRequested.current = false;

    let current = await tick();
    while (current && current.status === "running" && !stopRequested.current) {
      // Small pause between ticks so a sequence of browser requests doesn't
      // read as a hammering client to Vercel/Supabase/Open-Meteo.
      await new Promise((r) => setTimeout(r, 1500));
      current = await tick();
    }
    setRunning(false);
  }

  function handleStop() {
    stopRequested.current = true;
  }

  const progressPct = job
    ? Math.min(
        100,
        Math.round(
          ((new Date(job.cursorDate).getTime() - new Date(job.rangeStart).getTime()) /
            Math.max(1, new Date(job.rangeEnd).getTime() - new Date(job.rangeStart).getTime())) *
            100
        )
      )
    : 0;

  return (
    <div className="rounded-xl border border-brand-grey-green bg-brand-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-brand-teal-dark">Historical backfill</h2>
      <p className="mt-1 text-sm text-brand-muted">
        Pull historical weather telemetry for a past date range, before GIC goes live.
        Safe to stop and resume — progress is saved after every chunk.
      </p>

      <form onSubmit={handleRunUntilDone} className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="backfill-domain">
            Domain
          </label>
          <select
            id="backfill-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            disabled={running}
            className="mt-1 rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          >
            {domains.map((d) => (
              <option key={d} value={d}>
                {d.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="range-start">
            From
          </label>
          <input
            id="range-start"
            type="date"
            required
            value={rangeStart}
            onChange={(e) => setRangeStart(e.target.value)}
            className="mt-1 rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="range-end">
            To
          </label>
          <input
            id="range-end"
            type="date"
            required
            value={rangeEnd}
            onChange={(e) => setRangeEnd(e.target.value)}
            className="mt-1 rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={running}
          className="rounded-md bg-brand-teal px-4 py-2 text-sm font-medium text-brand-white transition hover:bg-brand-teal-dark disabled:opacity-60"
        >
          {running ? "Running…" : "Run until done"}
        </button>
        {running && (
          <button
            type="button"
            onClick={handleStop}
            className="rounded-md border border-brand-grey-green px-3 py-2 text-sm font-medium text-brand-ink-soft hover:bg-brand-teal-soft"
          >
            Stop
          </button>
        )}
      </form>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {job && (
        <div className="mt-4 rounded-md bg-brand-mint-pale px-4 py-3 text-sm text-brand-ink">
          <p>
            <span className="font-medium">{job.domain}</span> · {job.rangeStart} to{" "}
            {job.rangeEnd} · status: <span className="font-medium">{job.status}</span>
          </p>
          <div className="mt-2 h-2 w-full rounded-full bg-brand-grey-green">
            <div
              className="h-2 rounded-full bg-brand-teal transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-2 text-brand-ink-soft">
            Cursor at {job.cursorDate} · {job.rowsWritten.toLocaleString()} rows written so far
            {job.lastError ? ` · last error: ${job.lastError}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
