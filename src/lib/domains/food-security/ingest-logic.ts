/**
 * Pure parsing logic for HDX HAPI's food-security indicator (IPC/Cadre
 * Harmonisé acute food insecurity classification), a new domain — the
 * first built on HDX's HUMANITARIAN API rather than its CKAN file catalog
 * (compare fewsnet-ingest-logic.ts, which parses a static file from the
 * same HDX platform). See backfill.ts for the network/auth side.
 *
 * Field names below (ipc_phase, ipc_type, population_in_phase,
 * population_fraction_in_phase, reference_period_start,
 * reference_period_end, location_code, location_name, admin1_code,
 * admin1_name, admin2_code, admin2_name, admin_level, resource_hdx_id) are
 * confirmed against HDX HAPI's own published documentation
 * (hdx-hapi.readthedocs.io/en/latest/data_usage_guides/food_security_nutrition_and_poverty/),
 * not guessed — but this build environment's network allowlist blocks
 * hapi.humdata.org directly, so the exact JSON response ENVELOPE (is the
 * array top-level, or wrapped under a "data" key?) could not be confirmed
 * against a live call. See backfill.ts's extractRecords() for how that's
 * handled defensively.
 *
 * NIGERIA COVERAGE CAVEAT (documented, not independently confirmed): the
 * same HDX HAPI documentation states food-security data for Nigeria comes
 * from the Cadre Harmonisé (the West Africa/Sahel-region source HAPI
 * uses), and separately warns that several of Nigeria's admin2 regions
 * share names and are not individually p-coded in HAPI, carrying a "(1)"
 * suffix instead. Admin1/admin2 names are kept as free text for exactly
 * this reason — no attempt is made here to map them onto a separate
 * authoritative admin-boundary list, which would risk silently merging two
 * distinct Nigerian LGAs that happen to share a name.
 */

export type IpcPhase = "1" | "2" | "3" | "4" | "5" | "3+" | "all" | string;
export type IpcType = "current" | "first projection" | "second projection" | string;

export interface FoodSecurityObservation {
  locationCode: string;
  locationName: string;
  adminLevel: string;
  admin1Code: string;
  admin1Name: string;
  admin2Code: string;
  admin2Name: string;
  ipcPhase: IpcPhase;
  ipcType: IpcType;
  populationInPhase: number | null;
  populationFractionInPhase: number | null;
  referencePeriodStart: string; // YYYY-MM-DD
  referencePeriodEnd: string; // YYYY-MM-DD
  resourceHdxId: string | null;
}

const REQUIRED_KEYS = ["ipc_phase", "ipc_type", "reference_period_start", "reference_period_end"] as const;

function toTrimmedString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDateOnly(value: unknown): string | null {
  const s = toTrimmedString(value);
  const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/**
 * records is an array of plain objects from HAPI's
 * food-security-nutrition-poverty/food-security endpoint, already
 * extracted from whatever envelope the live response uses (see
 * backfill.ts). Filters to rows whose location_code is Nigeria ("NGA") —
 * defensively, even though the fetch layer already requests only that
 * location, in case a future call ever omits the filter.
 *
 * Throws if the records array is non-empty but not ONE of these rows
 * carries the required fields — a genuinely different response shape
 * should be a loud, specific failure, not a silent zero-row success.
 */
export function parseFoodSecurityRecords(records: Array<Record<string, unknown>>): FoodSecurityObservation[] {
  if (records.length === 0) return [];

  const sample = records[0];
  const missing = REQUIRED_KEYS.filter((k) => !(k in sample));
  if (missing.length > 0) {
    throw new Error(
      `HDX HAPI food_security response is missing expected field(s) [${missing.join(", ")}] — ` +
        `found keys: [${Object.keys(sample).join(", ")}]. Refusing to guess.`
    );
  }

  const results: FoodSecurityObservation[] = [];
  for (const record of records) {
    const locationCode = toTrimmedString(record["location_code"]).toUpperCase();
    if (locationCode !== "NGA") continue;

    const referencePeriodStart = toDateOnly(record["reference_period_start"]);
    const referencePeriodEnd = toDateOnly(record["reference_period_end"]);
    const ipcPhase = toTrimmedString(record["ipc_phase"]);
    const ipcType = toTrimmedString(record["ipc_type"]);
    if (!referencePeriodStart || !referencePeriodEnd || !ipcPhase || !ipcType) continue;

    results.push({
      locationCode,
      locationName: toTrimmedString(record["location_name"]) || "Nigeria",
      adminLevel: toTrimmedString(record["admin_level"]) || "0",
      admin1Code: toTrimmedString(record["admin1_code"]),
      admin1Name: toTrimmedString(record["admin1_name"]),
      admin2Code: toTrimmedString(record["admin2_code"]),
      admin2Name: toTrimmedString(record["admin2_name"]),
      ipcPhase,
      ipcType,
      populationInPhase: toNullableNumber(record["population_in_phase"]),
      populationFractionInPhase: toNullableNumber(record["population_fraction_in_phase"]),
      referencePeriodStart,
      referencePeriodEnd,
      resourceHdxId: toTrimmedString(record["resource_hdx_id"]) || null,
    });
  }

  return results.sort((a, b) =>
    (a.referencePeriodStart + a.admin1Code + a.admin2Code + a.ipcPhase + a.ipcType).localeCompare(
      b.referencePeriodStart + b.admin1Code + b.admin2Code + b.ipcPhase + b.ipcType
    )
  );
}
