"use client";

import { useEffect, useState } from "react";
import { COMMODITY_PRICE_SOURCES } from "@/lib/domains/commodity-prices/entry-schema";

interface ManualEntry {
  id: number;
  domain: string;
  entry_date: string;
  status: "pending" | "published" | "rejected";
  created_at: string;
  payload: { commodity?: string; market?: string; price?: number; unit?: string; currency?: string };
}

const STATUS_STYLE: Record<ManualEntry["status"], string> = {
  pending: "bg-status-watch-bg text-status-watch",
  published: "bg-status-info-bg text-status-info",
  rejected: "bg-status-alert-bg text-status-alert",
};

/**
 * Submission form for the commodity_prices manual-entry domain — shown on
 * /dashboard only to a data_entry account whose domain_scope includes
 * "commodity_prices" (see src/app/dashboard/page.tsx). Every submission
 * lands as 'pending' and is only visible elsewhere once a super_admin
 * publishes it via ManualEntryReviewPanel — this form just shows the
 * signed-in staffer their own submission history and its review status.
 */
export function CommodityPriceEntryForm() {
  const [commodity, setCommodity] = useState("");
  const [market, setMarket] = useState("National average");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [source, setSource] = useState<string>(COMMODITY_PRICE_SOURCES[0]);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sourceNote, setSourceNote] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [recent, setRecent] = useState<ManualEntry[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  // Shared fetch step with no setState of its own, so it's safe to call
  // both from the mount effect below (which does its own setState inline,
  // matching the pattern react-hooks/set-state-in-effect expects) and from
  // handleSubmit's own post-submit refresh (an event handler, not an
  // effect, so that call site has no such restriction).
  async function fetchRecentEntries(): Promise<ManualEntry[]> {
    const res = await fetch("/api/manual-entries?domain=commodity_prices");
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
          domain: "commodity_prices",
          entryDate,
          sourceNote: sourceNote.trim() || undefined,
          payload: {
            commodity,
            market,
            price: Number(price),
            unit,
            currency,
            source,
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to submit entry");
        return;
      }
      setSuccessMessage("Entry submitted — awaiting super-admin review before it's published.");
      setCommodity("");
      setPrice("");
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
      <h2 className="text-base font-semibold text-brand-teal-dark">Record a commodity price</h2>
      <p className="mt-1 text-sm text-brand-muted">
        Enter one commodity price observation (e.g. from NBS&apos;s Selected Food Price Watch).
        Every entry is reviewed by a super admin before it appears anywhere else in GIC.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="commodity">
            Commodity
          </label>
          <input
            id="commodity"
            required
            value={commodity}
            onChange={(e) => setCommodity(e.target.value)}
            placeholder="e.g. Rice (50kg bag)"
            className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="market">
            Market
          </label>
          <input
            id="market"
            required
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="price">
            Price
          </label>
          <input
            id="price"
            type="number"
            min="0"
            step="0.01"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="unit">
            Unit
          </label>
          <input
            id="unit"
            required
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="e.g. 50kg bag"
            className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="currency">
            Currency
          </label>
          <input
            id="currency"
            required
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="source">
            Source
          </label>
          <select
            id="source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          >
            {COMMODITY_PRICE_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="entry-date">
            Date
          </label>
          <input
            id="entry-date"
            type="date"
            required
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-brand-grey-green px-3 py-2 text-brand-ink focus:border-brand-teal focus:outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="source-note">
            Source note (optional)
          </label>
          <input
            id="source-note"
            value={sourceNote}
            onChange={(e) => setSourceNote(e.target.value)}
            placeholder="e.g. NBS Selected Food Price Watch, October 2026 report"
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
                  {entry.payload.commodity} — {entry.payload.currency} {entry.payload.price}/
                  {entry.payload.unit} ({entry.payload.market}) on {entry.entry_date}
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
