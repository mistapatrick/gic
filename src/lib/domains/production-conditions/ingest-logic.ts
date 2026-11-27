import { z } from "zod";

/**
 * Pure, side-effect-free FAOSTAT parsing logic for the production_conditions
 * domain — factored out exactly like weather/ingest-logic.ts, so it's
 * unit-tested directly with no live network/Supabase (see
 * tests/production-conditions-ingest-logic.test.ts).
 *
 * FAOSTAT Data API: https://fenixservices.fao.org/faostat/api/v1/{lang}/data/{domain}
 * Domain code QCL = "Crops and livestock products" (production quantities,
 * yield, and area harvested) — confirmed free, public, no API key required.
 * Data is published annually, not daily/weekly, so this domain's weekly cron
 * (see src/app/api/ingest/production-conditions/route.ts) will mostly no-op
 * outside FAOSTAT's own release windows; the real historical value comes
 * from the backfill run (src/lib/domains/production-conditions/backfill.ts).
 */

// ----------------------------------------------------------------------------
// Nigeria's FAOSTAT area code.
//
// Nigeria's UN M49 code (566) and ISO3 (NGA) are well established, but
// FAOSTAT's own "Area Code" field uses a separate legacy numbering scheme
// that is NOT the M49 code. 159 was identified from FAO's own published
// area-code reference material as the best candidate for Nigeria under that
// legacy scheme, but it could not be independently confirmed against a live
// API response from this build environment (the direct verification request
// was blocked by FAOSTAT's robots restrictions, not by a missing candidate).
//
// Rather than trust this number silently, every parsed record is checked
// against its own human-readable "Area" field (see parseFaostatRecords) —
// a response mismatch throws loudly instead of mis-filing another country's
// data as Nigeria's. Treat this constant as "best candidate, confirm on
// first live run" rather than "verified".
// ----------------------------------------------------------------------------
export const FAOSTAT_AREA_CODE_NIGERIA = 159;
export const FAOSTAT_DOMAIN_CODE = "QCL";
const EXPECTED_AREA_NAME = "nigeria";

export type ProductionMetric =
  | "production_quantity"
  | "yield"
  | "area_harvested"
  | "stocks"
  | "producing_animals_slaughtered";

/**
 * Elements are matched by their human-readable name (case-insensitive
 * substring), not by a hardcoded numeric Element Code — FAOSTAT's element
 * codes, like its area codes, could not be independently confirmed from
 * this environment, and the name string is both stable and unambiguous.
 *
 * "stocks" and "producing animals/slaughtered" are livestock-only elements
 * (FAOSTAT's QCL domain reports them against livestock-product items —
 * "Meat of cattle..." and "Raw milk of cattle" in TRACKED_COMMODITIES —
 * not against any crop item), added on the user's explicit request to
 * surface Nigeria's cattle-meat/cow-milk herd size and slaughter/producing
 * counts alongside the existing production/yield/area figures. The exact
 * "Producing Animals/Slaughtered" label is FAOSTAT's own standard element
 * name for this measure across all livestock-product items (meat, milk,
 * eggs, wool alike) per its public documentation, but — same caveat as
 * FAOSTAT_AREA_CODE_NIGERIA above — this could not be confirmed against a
 * live API response or a real downloaded file from this sandbox. If a
 * real FAOSTAT export's Element column uses different wording, this
 * substring simply won't match (rows are silently skipped, never
 * mis-filed) — check the real file's Element values against this list if
 * stocks/slaughter figures don't appear after a re-upload.
 */
const ELEMENT_METRIC_RULES: Array<{ match: string; metric: ProductionMetric }> = [
  { match: "production", metric: "production_quantity" },
  { match: "yield", metric: "yield" },
  { match: "area harvested", metric: "area_harvested" },
  { match: "producing animals/slaughtered", metric: "producing_animals_slaughtered" },
  { match: "stocks", metric: "stocks" },
];

export function matchMetric(elementName: string): ProductionMetric | null {
  const lower = elementName.toLowerCase();
  const rule = ELEMENT_METRIC_RULES.find((r) => lower.includes(r.match));
  return rule?.metric ?? null;
}

/**
 * The commodities GIC tracks for Nigeria's production-conditions domain —
 * Nigeria's major staple, cash, and one livestock-product line, matched by
 * FAOSTAT item NAME (one or more accepted variants, since FAOSTAT has
 * renamed items across revisions — e.g. "Maize" became "Maize (corn)") so
 * this list never depends on an unconfirmed numeric item code either. Each
 * entry's `commodity` is GIC's own stable label, stored on every row
 * regardless of which upstream item-name variant matched it.
 */
export interface TrackedCommodity {
  commodity: string;
  itemNameVariants: string[];
}

export const TRACKED_COMMODITIES: TrackedCommodity[] = [
  { commodity: "Maize", itemNameVariants: ["maize (corn)", "maize"] },
  { commodity: "Rice (paddy)", itemNameVariants: ["rice, paddy", "rice"] },
  { commodity: "Sorghum", itemNameVariants: ["sorghum"] },
  { commodity: "Millet", itemNameVariants: ["millet"] },
  { commodity: "Cassava", itemNameVariants: ["cassava, fresh", "cassava"] },
  { commodity: "Yams", itemNameVariants: ["yams"] },
  { commodity: "Cowpeas", itemNameVariants: ["cow peas, dry", "cowpeas, dry"] },
  { commodity: "Groundnuts", itemNameVariants: ["groundnuts, excluding shelled", "groundnuts, in shell", "groundnuts"] },
  { commodity: "Soya beans", itemNameVariants: ["soya beans"] },
  { commodity: "Cocoa beans", itemNameVariants: ["cocoa, beans", "cocoa beans"] },
  { commodity: "Oil palm fruit", itemNameVariants: ["oil palm fruit"] },
  { commodity: "Seed cotton", itemNameVariants: ["seed cotton, unginned", "seed cotton"] },
  { commodity: "Sesame seed", itemNameVariants: ["sesame seed"] },
  { commodity: "Cattle meat", itemNameVariants: ["meat of cattle with the bone, fresh or chilled"] },
  { commodity: "Cow milk", itemNameVariants: ["raw milk of cattle", "milk, whole fresh cow"] },
  // Added 2026-11-26 at the user's request. Unlike every entry above, these
  // four item-name variants are not a best guess from documentation — the
  // user supplied a real FAOSTAT QCL export for Nigeria (dated 2026-11-26)
  // containing these exact Item strings verbatim (item codes 01312, 01372,
  // 01657, 01313 respectively), so they're confirmed, not unconfirmed like
  // FAOSTAT_AREA_CODE_NIGERIA elsewhere in this file.
  { commodity: "Bananas", itemNameVariants: ["bananas"] },
  { commodity: "Cashew nuts", itemNameVariants: ["cashew nuts, in shell", "cashew nuts"] },
  { commodity: "Ginger", itemNameVariants: ["ginger, raw", "ginger"] },
  { commodity: "Plantains", itemNameVariants: ["plantains and cooking bananas", "plantains"] },
  // Added 2026-11-27 at the user's request (a plain-language crop list, not
  // a FAOSTAT export like the batch above). Each item name below was
  // checked against FAOSTAT's own published item/code references via web
  // research (FAO item codes cited alongside each entry) rather than
  // guessed from memory — a middle confidence tier: better-sourced than
  // the original 15 (pure documentation guesses, never independently
  // checked), but not as certain as the four directly above (confirmed
  // against a real, dated export the user supplied). Treat these as
  // "best candidate from published FAOSTAT references, confirm on first
  // live run" — same posture as FAOSTAT_AREA_CODE_NIGERIA above.
  //
  // Four items from the user's list are deliberately left out:
  // - "Banana", "Plantain", and "Ginger" are already tracked above.
  // - "Beans" is Nigeria's common name for cowpea (Vigna unguiculata),
  //   already tracked above as "Cowpeas" (FAOSTAT item "Cow peas, dry") —
  //   not a separate commodity.
  // - "Fluted pumpkin leaves" (ugu, Telfairia occidentalis) has no
  //   FAOSTAT item at all — FAO's own crop-use database states plainly
  //   that no statistical production data exists for it globally. This
  //   is a real gap in FAOSTAT's coverage, not a naming mismatch; tracking
  //   it would need a different data source (e.g. an NBS survey), out of
  //   scope for this FAOSTAT-only domain as currently built.
  { commodity: "Cashewapple", itemNameVariants: ["cashewapple", "cashew apple"] }, // FAO code 0591 — the fruit, distinct from "Cashew nuts, in shell" (FAO code 0217) already tracked above
  { commodity: "Shea nuts", itemNameVariants: ["karite nuts (sheanuts)", "shea nuts", "sheanuts"] }, // FAO code 0263, officially named "Karite nuts (sheanuts)"
  { commodity: "Carrots and turnips", itemNameVariants: ["carrots and turnips", "carrots"] },
  { commodity: "Cabbages", itemNameVariants: ["cabbages", "cabbages and other brassicas"] }, // FAO code 0358
  { commodity: "Lettuce and chicory", itemNameVariants: ["lettuce and chicory", "lettuce"] },
  { commodity: "Watermelons", itemNameVariants: ["watermelons"] },
  { commodity: "Melonseed", itemNameVariants: ["melonseed", "melon seed"] }, // FAO code 0299 — Nigeria's "egusi"; FAOSTAT's own data shows Nigeria as the world's largest producer
  { commodity: "Tomatoes", itemNameVariants: ["tomatoes"] },
  { commodity: "Chillies and peppers, green", itemNameVariants: ["chillies and peppers, green", "chillies and peppers"] }, // FAO code 0401 — FAOSTAT has no separate "bell pepper" item; this combined item covers both chillies and sweet/bell peppers together
  { commodity: "Sweet potatoes", itemNameVariants: ["sweet potatoes"] },
  { commodity: "Potatoes", itemNameVariants: ["potatoes"] }, // Nigeria's "Irish potato" (vs. sweet potato) — FAOSTAT's plain item name is just "Potatoes"
  { commodity: "Pineapples", itemNameVariants: ["pineapples"] }, // FAO code 0574
  { commodity: "Oranges", itemNameVariants: ["oranges"] },
];

export function matchCommodity(itemName: string): string | null {
  const lower = itemName.toLowerCase().trim();
  for (const entry of TRACKED_COMMODITIES) {
    if (entry.itemNameVariants.some((variant) => lower === variant || lower.startsWith(variant))) {
      return entry.commodity;
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// Defensive parsing of the upstream API response: FAOSTAT is a third party,
// so its payload is untrusted input, validated before any value is written
// to the database. Deliberately permissive (passthrough + optional code
// fields) since the exact set of extra columns FAOSTAT includes (Flag,
// Note, Year Code, …) is not load-bearing for this domain.
// ----------------------------------------------------------------------------
export const FaostatRecordSchema = z
  .object({
    "Area Code": z.number().optional(),
    Area: z.string(),
    "Item Code": z.number().optional(),
    Item: z.string(),
    "Element Code": z.number().optional(),
    Element: z.string(),
    Year: z.number(),
    Unit: z.string(),
    Value: z.number().nullable(),
  })
  .passthrough();

export const FaostatResponseSchema = z
  .object({
    data: z.array(FaostatRecordSchema),
  })
  .passthrough();

export type FaostatRecord = z.infer<typeof FaostatRecordSchema>;

export interface ProductionConditionRow {
  commodity: string;
  metric: ProductionMetric;
  value: number;
  unit: string;
  year: number;
  region: string;
  source: string;
  faostat_area_code: number | null;
  faostat_item_code: number | null;
  faostat_element_code: number | null;
}

export function buildFaostatUrl(areaCode: number, years: number[]): string {
  const yearParam = years.join(",");
  // item/element are deliberately omitted from the query — rather than
  // trust unconfirmed numeric codes for those too, every item/element
  // FAOSTAT returns for Nigeria in these years is fetched, then filtered
  // client-side in parseFaostatRecords by name against TRACKED_COMMODITIES
  // and ELEMENT_METRIC_RULES. A single country-year slice of domain QCL is
  // a few hundred rows, not a bulk download, so this stays a light request.
  return (
    `https://fenixservices.fao.org/faostat/api/v1/en/data/${FAOSTAT_DOMAIN_CODE}` +
    `?area=${areaCode}&year=${yearParam}`
  );
}

/**
 * Validates the raw response shape, then applies the defensive
 * Area-name check: if ANY row's Area field is not "Nigeria" (case
 * insensitive), the area-code filter did not do what it was expected to —
 * throw loudly rather than silently filing another country's data as
 * Nigeria's. An empty result set is NOT an error (a given year's release
 * may simply not be out yet).
 */
export function parseFaostatRecords(raw: unknown, expectedAreaCode: number): ProductionConditionRow[] {
  const parsed = FaostatResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`FAOSTAT response failed validation: ${parsed.error.message}`);
  }

  const rows: ProductionConditionRow[] = [];

  for (const record of parsed.data.data) {
    if (record.Area.trim().toLowerCase() !== EXPECTED_AREA_NAME) {
      throw new Error(
        `FAOSTAT area code ${expectedAreaCode} returned a row for "${record.Area}", not Nigeria — ` +
          `the configured FAOSTAT_AREA_CODE_NIGERIA is wrong and must be corrected before this ` +
          `domain can be trusted. Refusing to ingest this batch.`
      );
    }

    if (record.Value === null || !Number.isFinite(record.Value)) continue; // no figure published yet

    const commodity = matchCommodity(record.Item);
    if (!commodity) continue; // not one of GIC's tracked commodities

    const metric = matchMetric(record.Element);
    if (!metric) continue; // not one of ELEMENT_METRIC_RULES's tracked elements (e.g. "Prices")

    rows.push({
      commodity,
      metric,
      value: record.Value,
      unit: record.Unit,
      year: record.Year,
      region: "National",
      source: "FAOSTAT",
      faostat_area_code: record["Area Code"] ?? expectedAreaCode,
      faostat_item_code: record["Item Code"] ?? null,
      faostat_element_code: record["Element Code"] ?? null,
    });
  }

  return rows;
}

/**
 * Converts a calendar-date span (as handed down by the generic,
 * date-based backfill framework — see backfill-framework.ts) into the
 * distinct calendar years it spans, inclusive. This is what lets
 * production_conditions reuse that framework's date arithmetic unchanged
 * for an annual-granularity domain: a chunk's rangeStart/rangeEnd are still
 * ordinary dates, but this domain's own fetch/write functions read them as
 * "which years," not "which days" — the parallel of weather's
 * enumerateDates() in src/lib/domains/weather/backfill.ts.
 */
export function enumerateYears(startDate: string, endDate: string): number[] {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const years: number[] = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);
  return years;
}
