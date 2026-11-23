import { describe, expect, it } from "vitest";
import { validateStartBackfillInput } from "@/lib/ingestion/backfill-request";

describe("validateStartBackfillInput", () => {
  it("accepts a valid historical range for a known domain", () => {
    const result = validateStartBackfillInput({
      domain: "weather",
      rangeStart: "2020-01-01",
      rangeEnd: "2020-01-31",
    });
    expect(result.ok).toBe(true);
    expect(result.data?.chunkSizeDays).toBe(7); // default applied
  });

  it("rejects an unknown domain", () => {
    const result = validateStartBackfillInput({
      domain: "made_up_domain",
      rangeStart: "2020-01-01",
      rangeEnd: "2020-01-31",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects rangeStart after rangeEnd", () => {
    const result = validateStartBackfillInput({
      domain: "weather",
      rangeStart: "2020-02-01",
      rangeEnd: "2020-01-01",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/on or before/);
  });

  it("rejects a rangeEnd that is today or later", () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = validateStartBackfillInput({
      domain: "weather",
      rangeStart: "2020-01-01",
      rangeEnd: today,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/historical dates only/);
  });

  it("rejects a malformed date", () => {
    const result = validateStartBackfillInput({
      domain: "weather",
      rangeStart: "01/01/2020",
      rangeEnd: "2020-01-31",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an out-of-bounds chunkSizeDays", () => {
    const result = validateStartBackfillInput({
      domain: "weather",
      rangeStart: "2020-01-01",
      rangeEnd: "2020-01-31",
      chunkSizeDays: 0,
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a custom chunkSizeDays within bounds", () => {
    const result = validateStartBackfillInput({
      domain: "weather",
      rangeStart: "2020-01-01",
      rangeEnd: "2020-01-31",
      chunkSizeDays: 14,
    });
    expect(result.ok).toBe(true);
    expect(result.data?.chunkSizeDays).toBe(14);
  });

  it("accepts a multi-year chunkSizeDays for an annual-granularity domain", () => {
    // The cap was raised from 31 to 3650 in Sub-phase 2 specifically so
    // production_conditions (FAOSTAT, annual) can chunk efficiently — see
    // backfill-request.ts's comment on StartBackfillSchema.
    const result = validateStartBackfillInput({
      domain: "production_conditions",
      rangeStart: "1990-01-01",
      rangeEnd: "2025-12-31",
      chunkSizeDays: 3650,
    });
    expect(result.ok).toBe(true);
    expect(result.data?.chunkSizeDays).toBe(3650);
  });

  it("still rejects a chunkSizeDays beyond the new upper bound", () => {
    const result = validateStartBackfillInput({
      domain: "production_conditions",
      rangeStart: "1990-01-01",
      rangeEnd: "2025-12-31",
      chunkSizeDays: 99_999,
    });
    expect(result.ok).toBe(false);
  });
});
