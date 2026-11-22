import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";
import {
  DAILY_COLUMNS,
  ExportQuerySchema,
  HOURLY_COLUMNS,
  buildCsv,
  buildExportFilename,
  flattenDailyReports,
  mapHourlyRows,
  validateDateRange,
  type ClusterLookupRow,
  type DailyReportDbRow,
  type ObservedHourlyDbRow,
} from "@/lib/domains/weather/export-logic";
import { fetchAllPages } from "@/lib/paginate";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RATE_LIMIT = { limit: 10, windowMs: 60_000 }; // 10 export requests / minute / client

export async function GET(req: NextRequest) {
  // 1. Rate limit first — cheapest possible rejection, before touching the
  //    database. This is a public, unauthenticated endpoint (same read-only
  //    exposure as the dashboard itself and /api/brief-card — see
  //    SECURITY.md), so rate limiting is the abuse guard, not auth.
  const clientKey = getClientKey(req);
  const rl = checkRateLimit(`export:${clientKey}`, RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many export requests. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil((rl.resetAt - Date.now()) / 1000).toString() },
      }
    );
  }

  // 2. Strictly validate every query param before it touches a query or a
  //    response header.
  const { searchParams } = new URL(req.url);
  const parsed = ExportQuerySchema.safeParse({
    type: searchParams.get("type"),
    format: searchParams.get("format"),
    start: searchParams.get("start"),
    end: searchParams.get("end"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }
  const query = parsed.data;

  const rangeCheck = validateDateRange(query.start, query.end, query.type);
  if (!rangeCheck.ok) {
    return NextResponse.json({ error: rangeCheck.error }, { status: 400 });
  }

  // 3. Read with the anon/public client — same as the dashboard page itself.
  //    All three tables are public-read by RLS policy (see schema.sql), so
  //    this export serves nothing the dashboard doesn't already expose; it
  //    just re-packages it as a downloadable file.
  const supabase = getSupabaseBrowserClient();

  try {
    const filename = buildExportFilename(query);

    if (query.type === "hourly") {
      // Supabase's PostgREST API caps rows per request (1000 by default) no
      // matter how many match the filter, and trims silently rather than
      // erroring — a wide date range used to come back looking like it only
      // covered the first day or two of the range because this query never
      // asked for a second page. fetchAllPages() loops via .range() until a
      // short page confirms there's nothing left. The ORDER BY is fully
      // deterministic (date, then hour, then cluster_id) so offset-based
      // paging can't duplicate or skip rows across a page boundary.
      const [clustersRes, hourlyRes] = await Promise.all([
        supabase
          .from("weather_clusters")
          .select("id, state_label, cluster_name, geo_zone, latitude, longitude"),
        fetchAllPages<ObservedHourlyDbRow>((from, to) =>
          supabase
            .from("observed_hourly")
            .select(
              "cluster_id, obs_date, obs_hour, temp_2m_c, rel_humidity_pct, precip_mm, wind_speed_kmh, sunshine_hrs"
            )
            .gte("obs_date", query.start)
            .lte("obs_date", query.end)
            .order("obs_date", { ascending: true })
            .order("obs_hour", { ascending: true })
            .order("cluster_id", { ascending: true })
            .range(from, to)
        ),
      ]);

      if (clustersRes.error || hourlyRes.error) {
        console.error("[export] hourly query failed:", clustersRes.error ?? hourlyRes.error);
        return NextResponse.json({ error: "Export query failed" }, { status: 500 });
      }

      const clustersById = new Map(
        (clustersRes.data as ClusterLookupRow[] | null ?? []).map((c) => [c.id, c])
      );
      const rows = mapHourlyRows(hourlyRes.data, clustersById);

      return query.format === "csv"
        ? csvResponse(buildCsv(rows, HOURLY_COLUMNS), filename)
        : await xlsxResponse(rows, HOURLY_COLUMNS, "Hourly observed telemetry", filename);
    }

    // type === "daily" — same silent-truncation risk as the hourly query
    // above, just less likely to be hit in practice (one row per cluster
    // per day instead of per hour), so it's paginated the same way.
    const { data, error } = await fetchAllPages<DailyReportDbRow>((from, to) =>
      supabase
        .from("daily_observed_reports")
        .select("obs_date, cutoff_hour_wat, cluster_metrics")
        .gte("obs_date", query.start)
        .lte("obs_date", query.end)
        .order("obs_date", { ascending: true })
        .order("cutoff_hour_wat", { ascending: true })
        .range(from, to)
    );

    if (error) {
      console.error("[export] daily query failed:", error);
      return NextResponse.json({ error: "Export query failed" }, { status: 500 });
    }

    const rows = flattenDailyReports(data);

    return query.format === "csv"
      ? csvResponse(buildCsv(rows, DAILY_COLUMNS), filename)
      : await xlsxResponse(rows, DAILY_COLUMNS, "Daily observed summaries", filename);
  } catch (err) {
    console.error("[export] unexpected failure:", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}

function csvResponse(csv: string, filename: string): NextResponse {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

async function xlsxResponse<T extends object>(
  rows: T[],
  columns: { key: keyof T; header: string }[],
  sheetName: string,
  filename: string
): Promise<NextResponse> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Growthly Intelligence Centre";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: String(c.key),
    width: Math.max(12, c.header.length + 2),
  }));
  sheet.getRow(1).font = { bold: true };
  // exceljs assigns plain string/number values to typed XLSX cells (not a
  // formula object), so the file-open formula-injection risk that applies to
  // CSV doesn't apply here — the cell's stored type tells Excel it's text,
  // not a live formula. Added as data rows regardless of row count.
  sheet.addRows(rows as Record<string, unknown>[]);

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(Buffer.from(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
