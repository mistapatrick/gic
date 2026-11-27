"use client";

import { useEffect, useState } from "react";
import { PRODUCTION_CONDITION_METRICS } from "@/lib/domains/production-conditions/entry-schema";

interface ManualEntry {
  id: number;
  domain: string;
  entry_date: string;
  status: "pending" | "published" | "rejected";
  created_at: string;
  payload: { commodity?: string; metric?: string; value?: number; unit?: string; year?: number; region?: string };
}

const STATUS_STYLE: Record<ManualEntry["status"], string> = {
  pending: "bg-status-watch-bg text-status-watch",
  published: "bg-status-info-bg text-status-info",
  rejected: "bg-status-alert-bg text-status-alert",
};

const METRIC_LABELS: Record<(typeof PRODUCTION_CONDITION_METRICS)[number], string> = {
  production_quantity: "Production quantity",
  yield: "Yield",
  area_harvested: "Area harvested",
  stocks: "Stocks",
  producing_animals_slaughtered: "Producing animals / slaughtered",
};

/**
 * Submission form for the production_conditions manual-entry domain —
 * added 2026-11-27 (see src/lib/domains/production-conditions/entry-schema.ts
 * and src/lib/domains/registry.ts for why this domain, previously
 * machine-ingested only, now also has a manual path). Shown on /dashboard
 * to any account whose domain_scope includes "production_conditions" —
 * today that's super_admin only (synthesized to every DATA_ENTRY_DOMAINS
 * value), since no data_entry account has been scoped to this domain yet.
 *
 * Mirrors CommodityPriceEntryForm's shape closely — same submit/recent-list
 * pattern, same POST target — with the commodity-price-specific fields
 * (market, price, currency, source) swapped for this domain's own
 * (metric, value, year, region). The success message reflects the
 * response's own entry.status rather than assuming one outcome, since a
 * super_admin's submission self-publishes immediately while a data_entry
 * account's still lands pending (see /api/manual-entries' POST handler).
 */
export function ProductionConditionEntryForm() {
  const [commodity, setCommodity] = useState("");
  const [metric, setMetric] = useState<string>(PRODUCTION_CONDITION_METRICS[0]);
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [region, setRegion] = useState("National");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sourceNote, setSourceNote] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [recent, setRecent] = useState<ManualEntry[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  async function fetchRecentEntries(): Promise<ManualEntry[]> {
    const res = await fetch("/api/manual-entries?domain=production_conditions");
    if (!res.ok) throw new Error("Failed to load submissions");
    const body = await res.json();
    return body.entries ?? [];
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingRecent(true);
      try {
        const entries = await fetchRecentEntries();
        if (!cancelled) setRecent(entries);
      } catch {
        // Non-critical on initial mount — the form itself still works even
        // if the submission history fails to load.
      } finally {
        if (!cancelled) setLoadingRecent(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/manual-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: "production_conditions",
          entryDate,
          sourceNote: sourceNote.trim() || undefined,
          payload: {
            commodity,
            metric,
            value: Number(value),
            unit,
            year: Number(year),
            region,
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to submit entry");
        return;
      }
      setSuccessMessage(
        body.entry?.status === "published"
          ? "Entered and published immediately."
          : "Submitted — awaiting super-admin review before it's published."
      );
      setCommodity("");
      setValue("");
      setUnit("");
      setSourceNote("");
      setRecent(await fetchRecentEntries());
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-brand-grey-green bg-brand-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-brand-teal-dark">Record a production figure</h2>
      <p className="mt-1 text-sm text-brand-muted">
        Enter one production-conditions observation (production quantity, yield, area harvested,
        stocks, or slaughter count) for a commodity and year. The automated FAOSTAT ingestion keeps
        running unchanged — this is a backstop for whenever it can&apos;t reach or parse a source, or
        for correcting a figure by hand.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="pc-commodity">
            Commodity
          </label>
          <input
            id="pc-commodity"
            required
            value={commodity}
            onChange={(e) => setCommodity(e.target.value)}
            placeholder="e.g. Maize"
            className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="pc-metric">
            Metric
          </label>
          <select
            id="pc-metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          >
            {PRODUCTION_CONDITION_METRICS.map((m) => (
              <option key={m} value={m}>
                {METRIC_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="pc-value">
            Value
          </label>
          <input
            id="pc-value"
            type="number"
            min="0"
            step="0.01"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="pc-unit">
            Unit
          </label>
          <input
            id="pc-unit"
            required
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="e.g. tonnes"
            className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="pc-year">
            Year
          </label>
          <input
            id="pc-year"
            type="number"
            min="1960"
            max="2100"
            required
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="pc-region">
            Region
          </label>
          <input
            id="pc-region"
            required
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="pc-entry-date">
            Date
          </label>
          <input
            id="pc-entry-date"
            type="date"
            required
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="pc-source-note">
            Source note (optional)
          </label>
          <input
            id="pc-source-note"
            value={sourceNote}
            onChange={(e) => setSourceNote(e.target.value)}
            placeholder="e.g. FAOSTAT QCL export, downloaded 2026-11-27"
            className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          />
        </div>

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-brand-teal px-4 py-2 text-sm font-medium text-brand-white transition hover:bg-brand-teal-dark disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit entry"}
          </button>
        </div>
      </form>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {successMessage && (
        <p className="mt-4 rounded-md bg-brand-mint-pale px-3 py-2 text-sm text-brand-ink">{successMessage}</p>
      )}

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-brand-ink">Your recent submissions</h3>
        {loadingRecent ? (
          <p className="mt-2 text-sm text-brand-muted">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="mt-2 text-sm text-brand-muted">No submissions yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {recent.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between rounded-md border border-brand-grey-green px-3 py-2 text-sm"
              >
                <span className="text-brand-ink">
                  {entry.payload.commodity} — {entry.payload.metric?.replace(/_/g, " ")}:{" "}
                  {entry.payload.value} {entry.payload.unit} ({entry.payload.year}, {entry.payload.region})
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[entry.status]}`}>
                  {entry.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
