import { describe, expect, it, vi } from "vitest";
import {
  isJobComplete,
  computeChunkEnd,
  computeNextCursor,
  isOverTimeBudget,
  runBackfillTick,
  type BackfillJobState,
} from "@/lib/ingestion/backfill-framework";

describe("isJobComplete", () => {
  it("is false while cursor is within range", () => {
    expect(isJobComplete("2020-01-05", "2020-01-10")).toBe(false);
  });
  it("is true once cursor passes rangeEnd", () => {
    expect(isJobComplete("2020-01-11", "2020-01-10")).toBe(true);
  });
  it("is false when cursor exactly equals rangeEnd (last day still to fetch)", () => {
    expect(isJobComplete("2020-01-10", "2020-01-10")).toBe(false);
  });
});

describe("computeChunkEnd", () => {
  it("advances by chunkSizeDays - 1 from cursor", () => {
    expect(computeChunkEnd("2020-01-01", 7, "2020-12-31")).toBe("2020-01-07");
  });
  it("clamps to rangeEnd when the naive chunk would overshoot", () => {
    expect(computeChunkEnd("2020-01-28", 7, "2020-01-31")).toBe("2020-01-31");
  });
  it("handles a one-day chunk size", () => {
    expect(computeChunkEnd("2020-06-15", 1, "2020-12-31")).toBe("2020-06-15");
  });
  it("crosses a month boundary correctly", () => {
    expect(computeChunkEnd("2020-01-29", 7, "2020-12-31")).toBe("2020-02-04");
  });
});

describe("computeNextCursor", () => {
  it("is one day after the chunk end", () => {
    expect(computeNextCursor("2020-01-07")).toBe("2020-01-08");
  });
  it("crosses a year boundary", () => {
    expect(computeNextCursor("2020-12-31")).toBe("2021-01-01");
  });
});

describe("isOverTimeBudget", () => {
  it("is false before the budget elapses", () => {
    expect(isOverTimeBudget(1000, 5000, 3000)).toBe(false);
  });
  it("is true once elapsed time reaches the budget", () => {
    expect(isOverTimeBudget(1000, 5000, 6000)).toBe(true);
  });
});

function makeJob(overrides: Partial<BackfillJobState> = {}): BackfillJobState {
  return {
    domain: "weather",
    rangeStart: "2020-01-01",
    rangeEnd: "2020-01-21",
    cursorDate: "2020-01-01",
    chunkSizeDays: 7,
    status: "pending",
    rowsWritten: 0,
    lastError: null,
    ...overrides,
  };
}

describe("runBackfillTick", () => {
  it("runs every chunk to completion when time budget is generous", async () => {
    const fetchChunk = vi.fn().mockResolvedValue("fake-data");
    const writeChunk = vi.fn().mockResolvedValue(10);
    const persistProgress = vi.fn().mockResolvedValue(undefined);

    const result = await runBackfillTick({
      job: makeJob(),
      fetchChunk,
      writeChunk,
      persistProgress,
      delayBetweenChunksMs: 0,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    // 21-day range, 7-day chunks -> exactly 3 chunks.
    expect(fetchChunk).toHaveBeenCalledTimes(3);
    expect(writeChunk).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("completed");
    expect(result.rowsWritten).toBe(30);
    expect(persistProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "completed", rowsWritten: 30 })
    );
  });

  it("stops mid-job once the time budget is exhausted, leaving status running", async () => {
    let callCount = 0;
    const fetchChunk = vi.fn().mockResolvedValue("fake-data");
    const writeChunk = vi.fn().mockResolvedValue(5);
    const persistProgress = vi.fn().mockResolvedValue(undefined);

    // Clock that advances past the budget after the first chunk completes.
    const nowValues = [0, 0, 10_000, 10_000];
    const now = () => nowValues[Math.min(callCount++, nowValues.length - 1)];

    const result = await runBackfillTick({
      job: makeJob(),
      fetchChunk,
      writeChunk,
      persistProgress,
      delayBetweenChunksMs: 0,
      timeBudgetMs: 5_000,
      sleep: vi.fn().mockResolvedValue(undefined),
      now,
    });

    expect(result.status).toBe("running");
    expect(result.cursorDate).not.toBe("2020-01-01"); // progress was made
    expect(fetchChunk.mock.calls.length).toBeLessThan(3); // did not finish all chunks
  });

  it("marks the job failed and stops when a chunk throws, without losing earlier progress", async () => {
    const fetchChunk = vi
      .fn()
      .mockResolvedValueOnce("ok-data")
      .mockRejectedValueOnce(new Error("upstream API exploded"));
    const writeChunk = vi.fn().mockResolvedValue(10);
    const persistProgress = vi.fn().mockResolvedValue(undefined);

    const result = await runBackfillTick({
      job: makeJob(),
      fetchChunk,
      writeChunk,
      persistProgress,
      delayBetweenChunksMs: 0,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.status).toBe("failed");
    expect(result.lastError).toContain("upstream API exploded");
    expect(result.rowsWritten).toBe(10); // first successful chunk's rows kept
    expect(fetchChunk).toHaveBeenCalledTimes(2);
  });

  it("returns completed immediately for a job whose cursor is already past rangeEnd", async () => {
    const fetchChunk = vi.fn();
    const writeChunk = vi.fn();
    const persistProgress = vi.fn().mockResolvedValue(undefined);

    const result = await runBackfillTick({
      job: makeJob({ cursorDate: "2020-01-22" }),
      fetchChunk,
      writeChunk,
      persistProgress,
    });

    expect(fetchChunk).not.toHaveBeenCalled();
    expect(result.status).toBe("completed");
  });
});
