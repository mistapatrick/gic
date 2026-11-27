import { z } from "zod";
import type { ProductionMetric } from "@/lib/domains/production-conditions/ingest-logic";

/**
 * AI synthesis for the production_conditions public card — same pattern as
 * the weather domain's national_summary (see src/app/api/ingest/route.ts
 * and src/components/AgentBriefPanel.tsx), adapted to a domain that updates
 * by occasional FAOSTAT backfill/bulk-upload rather than a nightly cron.
 *
 * Deliberately a *read-time* synthesis (built in the API route each time
 * it's requested, not stored in the database at ingestion time): unlike
 * weather, there is no single "ingestion run" moment to hang generation off
 * — data arrives from three different entry points (the weekly
 * production-conditions cron, the production-conditions-bulk cron, and the
 * super-admin manual CSV upload panel) and could change from any of them.
 * The API route bounds the resulting Gemini usage with
 * `export const revalidate`, not by moving generation into each ingestion
 * path.
 */
export const ProductionBriefSchema = z.object({
  national_summary: z
    .string()
    .describe(
      "Concise 2-3 sentence factual synthesis of Nigeria's most recent tracked-commodity " +
        "production figures (FAOSTAT). State which commodities lead in volume and note any " +
        "year-over-year change ONLY for a commodity where at least two years of production " +
        "data are given below — otherwise describe its latest level only. No speculation " +
        "about future seasons or prices."
    ),
  standout_insights: z
    .array(z.string())
    .max(4)
    .describe(
      "0-4 short, punchy one-sentence highlights, each about a single commodity (e.g. a " +
        "notable production level, a year-over-year change where the data supports one, or a " +
        "high yield-per-hectare figure). Grounded only in the figures given below."
    ),
});

export type ProductionBrief = z.infer<typeof ProductionBriefSchema>;

export interface ProductionBriefRow {
  commodity: string;
  metric: ProductionMetric;
  value: number;
  unit: string;
  year: number;
}

const METRIC_LABEL: Record<ProductionMetric, string> = {
  production_quantity: "production",
  yield: "yield",
  area_harvested: "area harvested",
  stocks: "stocks",
  producing_animals_slaughtered: "producing animals/slaughtered",
};

/**
 * Groups rows by commodity, then by metric, sorting each metric's years
 * newest-first and keeping at most the two most recent years (enough for a
 * year-over-year comparison without flooding the prompt as more years
 * accumulate). Pure and order-independent on input.
 */
export function buildCompactProductionTelemetry(rows: ProductionBriefRow[]): string {
  const byCommodity = new Map<string, ProductionBriefRow[]>();
  for (const row of rows) {
    const list = byCommodity.get(row.commodity) ?? [];
    list.push(row);
    byCommodity.set(row.commodity, list);
  }

  const lines: string[] = [];
  for (const [commodity, commodityRows] of byCommodity) {
    const byMetric = new Map<ProductionMetric, ProductionBriefRow[]>();
    for (const row of commodityRows) {
      const list = byMetric.get(row.metric) ?? [];
      list.push(row);
      byMetric.set(row.metric, list);
    }

    const parts: string[] = [];
    for (const [metric, metricRows] of byMetric) {
      const sorted = [...metricRows].sort((a, b) => b.year - a.year).slice(0, 2);
      const figs = sorted.map((r) => `${r.value.toLocaleString()} ${r.unit} (${r.year})`).join(", ");
      parts.push(`${METRIC_LABEL[metric]} ${figs}`);
    }

    lines.push(`${commodity}: ${parts.join("; ")}`);
  }

  return lines.join("\n");
}

export function buildProductionBriefPrompt(compactTelemetry: string): string {
  return (
    "You are an agricultural data analyst for Growthly Intelligence Centre, a Nigeria-focused " +
    "agricultural data product. Below are the most recent FAOSTAT-sourced national production " +
    "figures for Nigeria's tracked commodities (each line: commodity, then its most recent " +
    "1-2 years of production/yield/area-harvested figures, newest first).\n\n" +
    `${compactTelemetry}\n\n` +
    "Write the synthesis and standout insights described in the schema. Use only the figures " +
    "given above — never invent a year, a figure, or a trend the data doesn't support."
  );
}
