"use client";

import { useRef, useState } from "react";

/**
 * Super-admin manual file-upload for production_conditions — the UI half
 * of src/app/api/admin/production-conditions/bulk-upload/route.ts. See
 * that route for why this exists (a human-driven fallback for when even
 * bulks-faostat.fao.org can't be reached from this app's own
 * infrastructure). Accepts the .zip a human downloaded directly from
 * FAOSTAT's bulk-download page, or an already-unzipped .csv — the route
 * itself detects which one it got.
 */
interface SkippedCommodity {
  itemName: string;
  count: number;
}

interface UploadResult {
  fileName: string;
  rowsWritten: number;
  skippedCommodities: SkippedCommodity[];
}

export function ProductionConditionsBulkUploadPanel() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first");
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/production-conditions/bulk-upload", {
        method: "POST",
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Upload failed");
        return;
      }
      setResult({
        fileName: file.name,
        rowsWritten: body.rows_written,
        skippedCommodities: body.skipped_commodities ?? [],
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setError("Upload failed — check your connection and try again");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-xl border border-brand-grey-green bg-brand-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-brand-teal-dark">
        Produce stats — manual file upload
      </h2>
      <p className="mt-1 text-sm text-brand-muted">
        Upload FAOSTAT&apos;s bulk production-data file directly — the .zip from FAOSTAT&apos;s
        bulk-download page, or an already-unzipped .csv. Use this if the automated weekly
        download can&apos;t reach FAOSTAT on its own.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-sm font-medium text-brand-ink-soft" htmlFor="bulk-file">
            File (.zip or .csv)
          </label>
          <input
            id="bulk-file"
            type="file"
            accept=".zip,.csv"
            ref={fileInputRef}
            disabled={uploading}
            className="mt-1 text-sm text-brand-ink-soft file:mr-3 file:rounded-md file:border-0 file:bg-brand-teal-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-teal-dark"
          />
        </div>
        <button
          type="submit"
          disabled={uploading}
          className="rounded-md bg-brand-teal px-4 py-2 text-sm font-medium text-brand-white transition hover:bg-brand-teal-dark disabled:opacity-60"
        >
          {uploading ? "Uploading…" : "Upload and ingest"}
        </button>
      </form>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {result && (
        <div
          className={`mt-4 rounded-md px-4 py-3 text-sm ${
            result.rowsWritten === 0
              ? "bg-amber-50 text-amber-800"
              : "bg-brand-mint-pale text-brand-ink"
          }`}
        >
          <p>
            <span className="font-medium">{result.fileName}</span>{" "}
            {result.rowsWritten === 0 ? "processed, but wrote 0 rows" : "ingested"} ·{" "}
            {result.rowsWritten.toLocaleString()} rows written
          </p>
          {result.skippedCommodities.length > 0 && (
            <div className="mt-2">
              <p className="font-medium">
                {result.skippedCommodities.reduce((sum, c) => sum + c.count, 0).toLocaleString()} cell
                {result.skippedCommodities.reduce((sum, c) => sum + c.count, 0) === 1 ? "" : "s"} skipped —
                these item names aren&apos;t on the tracked-commodity list yet:
              </p>
              <ul className="mt-1 list-inside list-disc">
                {result.skippedCommodities.map((c) => (
                  <li key={c.itemName}>
                    &ldquo;{c.itemName}&rdquo; — {c.count.toLocaleString()} cell{c.count === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs opacity-80">
                Ask for these to be added to the tracked-commodity list (with a sample FAOSTAT export
                confirming the exact item name) if this data should appear on Produce Stats.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
