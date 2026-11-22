/**
 * Generic, resumable, rate-limited historical-backfill runner.
 *
 * Every data domain (weather today; input pricing, crop pest tracking,
 * livestock outbreak tracking in later sub-phases) needs the same shape of
 * job: "fetch and store everything from date A to date B," too large to do
 * in one request, safe to re-run, and polite to whatever upstream API it's
 * pulling from. Rather than write that loop once per domain, this module
 * owns the loop and each domain supplies two functions (fetchChunk,
 * writeChunk) — see src/lib/domains/weather/backfill.ts for the first one.
 *
 * Split deliberately into pure date/time arithmetic (unit-tested directly,
 * no I/O) and an orchestrator that takes fetch/write/persist as injected
 * functions, so the loop itself is testable with fakes — no real Supabase
 * or real upstream API needed (see tests/backfill-framework.test.ts).
 */

export interface BackfillJobState {
  domain: string;
  rangeStart: string; // YYYY-MM-DD
  rangeEnd: string; // YYYY-MM-DD, inclusive
  cursorDate: string; // next date still to fetch
  chunkSizeDays: number;
  status: "pending" | "running" | "completed" | "failed";
  rowsWritten: number;
  lastError: string | null;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The job is done once there is no date left on/after cursorDate within range. */
export function isJobComplete(cursorDate: string, rangeEnd: string): boolean {
  return compareDates(cursorDate, rangeEnd) > 0;
}

/**
 * The end date of the next chunk to fetch, clamped so it never runs past
 * rangeEnd — the last chunk of a job is usually shorter than chunkSizeDays.
 */
export function computeChunkEnd(
  cursorDate: string,
  chunkSizeDays: number,
  rangeEnd: string
): string {
  const naiveEnd = addDays(cursorDate, chunkSizeDays - 1);
  return compareDates(naiveEnd, rangeEnd) > 0 ? rangeEnd : naiveEnd;
}

export function computeNextCursor(chunkEnd: string): string {
  return addDays(chunkEnd, 1);
}

/** True once elapsed time since the tick started is at/over the time budget. */
export function isOverTimeBudget(startedAtMs: number, budgetMs: number, nowMs: number): boolean {
  return nowMs - startedAtMs >= budgetMs;
}

export interface RunBackfillTickOptions {
  job: BackfillJobState;
  fetchChunk: (chunkStart: string, chunkEnd: string) => Promise<unknown>;
  writeChunk: (data: unknown, chunkStart: string, chunkEnd: string) => Promise<number>;
  persistProgress: (job: BackfillJobState) => Promise<void>;
  /** Milliseconds to wait between chunks, so the upstream API isn't hammered. */
  delayBetweenChunksMs?: number;
  /** Stop looping (but don't fail) once this much wall-clock time has elapsed,
   *  leaving the job "running" with an advanced cursor for the next invocation
   *  to pick up — this is what keeps a multi-year job inside Vercel's 60s cap. */
  timeBudgetMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs as many chunks as fit in the time budget, persisting the job's
 * progress after every single chunk (not just at the end) — so a crash,
 * timeout, or deploy mid-job loses at most one chunk's work, never the
 * whole job. Never throws on a single chunk failure: it records the error
 * on the job, marks it "failed", persists that, and returns — a human
 * (super admin, via /api/admin/backfill) decides whether to retry.
 */
export async function runBackfillTick(options: RunBackfillTickOptions): Promise<BackfillJobState> {
  const {
    fetchChunk,
    writeChunk,
    persistProgress,
    delayBetweenChunksMs = 1000,
    timeBudgetMs = 45_000,
    sleep = defaultSleep,
    now = () => Date.now(),
  } = options;

  let job: BackfillJobState = { ...options.job, status: "running", lastError: null };
  const startedAt = now();

  while (!isJobComplete(job.cursorDate, job.rangeEnd)) {
    if (isOverTimeBudget(startedAt, timeBudgetMs, now())) {
      // Not done, not failed — just out of time for this invocation.
      job = { ...job, status: "running" };
      await persistProgress(job);
      return job;
    }

    const chunkStart = job.cursorDate;
    const chunkEnd = computeChunkEnd(chunkStart, job.chunkSizeDays, job.rangeEnd);

    try {
      const data = await fetchChunk(chunkStart, chunkEnd);
      const rows = await writeChunk(data, chunkStart, chunkEnd);
      job = {
        ...job,
        cursorDate: computeNextCursor(chunkEnd),
        rowsWritten: job.rowsWritten + rows,
      };
      await persistProgress(job);
    } catch (err) {
      job = {
        ...job,
        status: "failed",
        lastError: err instanceof Error ? err.message : String(err),
      };
      await persistProgress(job);
      return job;
    }

    if (!isJobComplete(job.cursorDate, job.rangeEnd) && delayBetweenChunksMs > 0) {
      await sleep(delayBetweenChunksMs);
    }
  }

  job = { ...job, status: "completed" };
  await persistProgress(job);
  return job;
}
