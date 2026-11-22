import { describe, expect, it } from "vitest";
import { fetchAllPages } from "@/lib/paginate";

/** Builds a fake paginated data source and a buildPage callback over it,
 *  mirroring the shape of a Supabase .range(from, to) call. */
function fakeSource<T>(all: T[]) {
  let calls = 0;
  const buildPage = (from: number, to: number) => {
    calls += 1;
    return Promise.resolve({ data: all.slice(from, to + 1), error: null });
  };
  return { buildPage, callCount: () => calls };
}

describe("fetchAllPages", () => {
  it("returns everything in a single page when under the page size", async () => {
    const { buildPage, callCount } = fakeSource([1, 2, 3]);
    const { data, error } = await fetchAllPages(buildPage, 1000);
    expect(error).toBeNull();
    expect(data).toEqual([1, 2, 3]);
    expect(callCount()).toBe(1); // a short page ends the loop — no wasted trailing request
  });

  it("returns an empty array, not an error, when nothing matches", async () => {
    const { buildPage } = fakeSource<number>([]);
    const { data, error } = await fetchAllPages(buildPage, 1000);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("pages across a boundary that lands exactly on the page size", async () => {
    // 1000 rows, pageSize 1000: this is the exact shape of the bug report —
    // a result that's a clean multiple of the page size must NOT be
    // mistaken for "that's everything" just because the last page was full.
    const all = Array.from({ length: 1000 }, (_, i) => i);
    const { buildPage, callCount } = fakeSource(all);
    const { data, error } = await fetchAllPages(buildPage, 1000);
    expect(error).toBeNull();
    expect(data).toHaveLength(1000);
    // A full page alone is ambiguous (could be "exactly 1000" or "1000+");
    // the implementation must fetch one more page to find out, and that
    // page will come back empty, ending the loop.
    expect(callCount()).toBe(2);
  });

  it("pages across multiple full pages plus a short final page", async () => {
    const all = Array.from({ length: 2450 }, (_, i) => i);
    const { buildPage, callCount } = fakeSource(all);
    const { data, error } = await fetchAllPages(buildPage, 1000);
    expect(error).toBeNull();
    expect(data).toHaveLength(2450);
    expect(data[0]).toBe(0);
    expect(data[2449]).toBe(2449);
    expect(callCount()).toBe(3); // 1000 + 1000 + 450
  });

  it("stops and surfaces the error on a failing page, keeping whatever was already fetched", async () => {
    let calls = 0;
    const buildPage = () => {
      calls += 1;
      if (calls === 2) {
        return Promise.resolve({ data: null, error: { message: "boom" } });
      }
      return Promise.resolve({ data: [1], error: null });
    };
    const { data, error } = await fetchAllPages(buildPage, 1);
    expect(error).toEqual({ message: "boom" });
    expect(data).toEqual([1]); // page 1's row isn't thrown away because page 2 failed
    expect(calls).toBe(2); // doesn't keep looping after an error
  });

  it("respects a custom page size", async () => {
    const all = Array.from({ length: 7 }, (_, i) => i);
    const { buildPage, callCount } = fakeSource(all);
    const { data } = await fetchAllPages(buildPage, 3);
    expect(data).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(callCount()).toBe(3); // 3 + 3 + 1
  });
});
