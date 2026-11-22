/**
 * Pages through a Supabase (PostgREST) query using .range(), so a result set
 * larger than the API's configured max-rows cap (1000 on a typical Supabase
 * project, regardless of how many rows actually match the filter) doesn't
 * get silently truncated. PostgREST applies that cap per request and
 * returns no error when it trims a response — a caller that never asks for
 * a second page just gets however many rows fit the cap, ordered by
 * whatever ORDER BY was given, with nothing in the response signaling that
 * more rows existed.
 *
 * That's exactly the shape of the hourly/daily export bug this fixes: a
 * wide date range looked like it only covered the first day or two,
 * because /api/export's query was a single unpaginated .select(), and the
 * export quietly got cut off at the 1000-row mark — see tests/export-logic
 * for the row-shaping side of the export, and route.ts for where this is
 * now used.
 *
 * `buildPage` must apply a fully deterministic ORDER BY (every tie broken —
 * e.g. order by date, then hour, then cluster_id). Offset-based paging over
 * a non-deterministic order can silently duplicate or skip rows across page
 * boundaries, which would reintroduce a subtler version of the same bug.
 */
export interface PageResult<T> {
  data: T[];
  error: unknown;
}

export async function fetchAllPages<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000
): Promise<PageResult<T>> {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) {
      return { data: rows, error };
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) {
      return { data: rows, error: null };
    }
    from += pageSize;
  }
}
