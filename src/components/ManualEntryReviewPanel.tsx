"use client";

import { useEffect, useState } from "react";

interface ManualEntry {
  id: number;
  domain: string;
  entry_date: string;
  source_note: string | null;
  status: "pending" | "published" | "rejected";
  created_at: string;
  payload: Record<string, unknown>;
}

/**
 * Super-admin review queue for the generic manual-entry framework
 * (migration 0004) — works across every manual-entry domain unchanged;
 * commodity_prices is the only one with submissions to review today.
 * Deliberately lists only 'pending' entries: once reviewed, an entry
 * either disappears into the public published view or stays visible here
 * only if a future "show reviewed history" filter is added — out of scope
 * for this first version.
 */
export function ManualEntryReviewPanel() {
  const [entries, setEntries] = useState<ManualEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOnId, setActingOnId] = useState<number | null>(null);

  // Shared fetch+parse step with no setState of its own, reused by the
  // mount effect below (which does its own setState inline, matching the
  // pattern react-hooks/set-state-in-effect expects) and by the manual
  // "Refresh" button (an event handler, not an effect).
  async function fetchPendingEntries(): Promise<ManualEntry[]> {
    const res = await fetch("/api/manual-entries?status=pending");
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Failed to load pending entries");
    return body.entries ?? [];
  }

  async function handleRefresh() {
    setLoading(true);
    setError(null);
    try {
      setEntries(await fetchPendingEntries());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await fetchPendingEntries();
        if (!cancelled) setEntries(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Network error — please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleReview(id: number, action: "publish" | "reject") {
    setActingOnId(id);
    setError(null);
    try {
      const res = await fetch(`/api/manual-entries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to review entry");
        return;
      }
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      setError("Network error — please try again.");
    } finally {
      setActingOnId(null);
    }
  }

  return (
    <div className="rounded-xl border border-brand-grey-green bg-brand-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-brand-teal-dark">Pending manual entries</h2>
          <p className="mt-1 text-sm text-brand-muted">
            Review submissions from data-entry accounts before they become publicly visible.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          className="rounded-md border border-brand-grey-green px-3 py-1.5 text-xs font-medium text-brand-ink-soft hover:bg-brand-teal-soft disabled:opacity-60"
        >
          Refresh
        </button>
      </div>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-brand-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-4 text-sm text-brand-muted">Nothing pending review.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-md border border-brand-grey-green px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-brand-ink">
                    {entry.domain.replace(/_/g, " ")} · {entry.entry_date}
                  </p>
                  <pre className="mt-1 whitespace-pre-wrap text-xs text-brand-ink-soft">
                    {JSON.stringify(entry.payload, null, 2)}
                  </pre>
                  {entry.source_note && (
                    <p className="mt-1 text-xs text-brand-muted">Note: {entry.source_note}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={actingOnId === entry.id}
                    onClick={() => handleReview(entry.id, "publish")}
                    className="rounded-md bg-brand-teal px-3 py-1.5 text-xs font-medium text-brand-white transition hover:bg-brand-teal-dark disabled:opacity-60"
                  >
                    Publish
                  </button>
                  <button
                    type="button"
                    disabled={actingOnId === entry.id}
                    onClick={() => handleReview(entry.id, "reject")}
                    className="rounded-md border border-brand-grey-green px-3 py-1.5 text-xs font-medium text-brand-ink-soft hover:bg-brand-teal-soft disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
