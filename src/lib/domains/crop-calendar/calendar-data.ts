import { GEO_ZONES, type GeoZone } from "@/lib/types";
import { TRACKED_COMMODITIES } from "@/lib/domains/production-conditions/ingest-logic";

/**
 * Static agricultural-calendar reference: typical planting and harvest
 * windows per tracked commodity per geo-zone, for the crop_calendar domain
 * the user approved on 2026-11-27 ("a proper agricultural calendar tying
 * weather observations to planting/harvest seasons by crop").
 *
 * SOURCING AND CONFIDENCE: these are general, nationally/regionally known
 * agronomic windows (Nigeria has one unimodal rainy season in the far north
 * and a longer, sometimes bimodal one in the south — the single biggest
 * driver of when each crop is planted), researched against FAO's own
 * published crop-calendar data for Nigeria, NAERLS/FMARD-style extension
 * guidance, and the 2026 commodity.ng agricultural calendar — not a
 * cluster-level or even state-level survey. Actual planting dates shift
 * every year with the real onset of the rains (confirmed in the same
 * research: optimum sowing dates for a single crop can shift by several
 * weeks across different years and sub-zones), so these windows are
 * deliberately described as typical ranges, not fixed dates, and the UI
 * must say so rather than imply precision this data doesn't have.
 *
 * WHY NO "ON TRACK / EARLY / DELAYED" VERDICT: that would require a
 * verified historical rainfall-onset baseline per zone to compare the
 * current season against. This product's own weather history
 * (observed_hourly) only goes back to whenever each cluster's backfill was
 * run — not a multi-decade climatological normal — so computing a deviation
 * figure here would fabricate precision the data can't support. Instead,
 * the crop_calendar UI pairs this static calendar with the zone's own
 * recently observed rainfall (see CropCalendarCard.tsx) labeled plainly as
 * "current conditions", never as a comparison to a historical average.
 *
 * Livestock commodities (Cattle meat, Cow milk — tracked in
 * production-conditions/ingest-logic.ts) are deliberately left out: they
 * have no planting/harvest cycle, so a "calendar" entry for them would be
 * meaningless. Cassava is also a special case — it's harvested continuously
 * from 9 to 18 months after planting rather than in a single seasonal
 * window — and is annotated as such rather than given a misleading harvest
 * range.
 */

export interface CropCalendarEntry {
  /** Must match a `commodity` value in TRACKED_COMMODITIES (production-conditions/ingest-logic.ts). */
  commodity: string;
  plantingWindow: string;
  harvestWindow: string;
  notes?: string;
}

export const CROP_CALENDAR: Record<GeoZone, CropCalendarEntry[]> = {
  "North-West": [
    {
      commodity: "Millet",
      plantingWindow: "June – July",
      harvestWindow: "September – October",
      notes: "Drought-tolerant staple of the Sudan/Sahel savanna belt (Jigawa, Zamfara, Sokoto).",
    },
    {
      commodity: "Sorghum",
      plantingWindow: "May – June",
      harvestWindow: "October – November",
    },
    {
      commodity: "Groundnuts",
      plantingWindow: "June – July",
      harvestWindow: "October – November",
      notes: "Historic Kano-Katsina-Zamfara \"groundnut pyramid\" belt.",
    },
    {
      commodity: "Seed cotton",
      plantingWindow: "June – July",
      harvestWindow: "November – January",
    },
    {
      commodity: "Maize",
      plantingWindow: "June – July",
      harvestWindow: "September – November",
      notes: "Northern Nigeria's optimum maize sowing is consistently later than the south's.",
    },
    {
      commodity: "Cowpeas",
      plantingWindow: "June – August",
      harvestWindow: "October – December",
      notes: "Commonly intercropped with millet, sorghum or maize.",
    },
    {
      commodity: "Rice (paddy)",
      plantingWindow: "May – July",
      harvestWindow: "October – December",
      notes: "Kebbi, Sokoto, Jigawa and Kano also run a second, irrigated dry-season cycle (roughly November – April) on top of this rainfed one.",
    },
    {
      commodity: "Ginger",
      plantingWindow: "April – June",
      harvestWindow: "November – January",
      notes: "Kaduna's Kachia-Jaba-Kagarko belt; an 8–10 month crop cycle.",
    },
    {
      commodity: "Tomatoes",
      plantingWindow: "October – December (dry-season/irrigated)",
      harvestWindow: "February – April",
    },
  ],
  "North-East": [
    {
      commodity: "Millet",
      plantingWindow: "June – July",
      harvestWindow: "September – October",
    },
    {
      commodity: "Sorghum",
      plantingWindow: "May – June",
      harvestWindow: "October – November",
    },
    {
      commodity: "Groundnuts",
      plantingWindow: "June – July",
      harvestWindow: "October – November",
    },
    {
      commodity: "Seed cotton",
      plantingWindow: "June – July",
      harvestWindow: "November – January",
      notes: "Adamawa is one of Nigeria's established cotton-growing states.",
    },
    {
      commodity: "Maize",
      plantingWindow: "June – July",
      harvestWindow: "September – November",
    },
    {
      commodity: "Cowpeas",
      plantingWindow: "June – August",
      harvestWindow: "October – December",
    },
    {
      commodity: "Potatoes",
      plantingWindow: "September – October",
      harvestWindow: "December – January",
      notes: "Mambilla Plateau's cool highland climate supports a dry-season Irish potato crop, similar to Jos Plateau.",
    },
  ],
  "North-Central": [
    {
      commodity: "Yams",
      plantingWindow: "February – April",
      harvestWindow: "August – October",
      notes: "The Middle Belt is Nigeria's heaviest yam-producing zone.",
    },
    {
      commodity: "Soya beans",
      plantingWindow: "May – July",
      harvestWindow: "October – November",
      notes: "Benue is Nigeria's largest soybean producer.",
    },
    {
      commodity: "Rice (paddy)",
      plantingWindow: "May – July",
      harvestWindow: "October – December",
    },
    {
      commodity: "Sesame seed",
      plantingWindow: "June – July",
      harvestWindow: "October – November",
    },
    {
      commodity: "Cassava",
      plantingWindow: "March – June",
      harvestWindow: "Continuous, 9–18 months after planting (not a single seasonal window)",
    },
    {
      commodity: "Maize",
      plantingWindow: "March – April (early) / August (late)",
      harvestWindow: "June – July (early) / October – November (late)",
    },
    {
      commodity: "Potatoes",
      plantingWindow: "September – October",
      harvestWindow: "December – January",
      notes: "Jos Plateau's cool highland climate — distinctive among Nigeria's largely lowland potato-growing areas.",
    },
    {
      commodity: "Carrots and turnips",
      plantingWindow: "September – November",
      harvestWindow: "December – February",
      notes: "Grown alongside potatoes and cabbages in Plateau's temperate-vegetable belt.",
    },
    {
      commodity: "Cabbages",
      plantingWindow: "September – November",
      harvestWindow: "December – February",
    },
  ],
  "South-West": [
    {
      commodity: "Cocoa beans",
      plantingWindow: "April – June (new fields)",
      harvestWindow: "October – January (main crop), April – July (lighter mid-crop)",
      notes: "Ondo is Nigeria's largest cocoa-producing state; Ekiti and Osun also grow cocoa.",
    },
    {
      commodity: "Oranges",
      plantingWindow: "April – June (new trees)",
      harvestWindow: "November – February",
      notes: "Established citrus orchards fruit on their own annual cycle rather than a fresh planting each year.",
    },
    {
      commodity: "Cassava",
      plantingWindow: "March – June",
      harvestWindow: "Continuous, 9–18 months after planting (not a single seasonal window)",
    },
    {
      commodity: "Maize",
      plantingWindow: "March – April (early) / August (late)",
      harvestWindow: "June – July (early) / October – November (late)",
    },
    {
      commodity: "Oil palm fruit",
      plantingWindow: "April – June (new plantings)",
      harvestWindow: "Year-round, with peak fruiting typically March – August",
      notes: "Mature palms fruit continuously; this is a maturity-driven cycle, not an annual sowing one.",
    },
    {
      commodity: "Yams",
      plantingWindow: "February – April",
      harvestWindow: "August – October",
    },
  ],
  "South-East": [
    {
      commodity: "Rice (paddy)",
      plantingWindow: "May – July",
      harvestWindow: "October – December",
      notes: "Abakaliki (Ebonyi) and Adani (Enugu) are two of Nigeria's best-known rice belts.",
    },
    {
      commodity: "Yams",
      plantingWindow: "February – April",
      harvestWindow: "August – October",
    },
    {
      commodity: "Cassava",
      plantingWindow: "March – June",
      harvestWindow: "Continuous, 9–18 months after planting (not a single seasonal window)",
    },
    {
      commodity: "Oil palm fruit",
      plantingWindow: "April – June (new plantings)",
      harvestWindow: "Year-round, with peak fruiting typically March – August",
    },
  ],
  "South-South": [
    {
      commodity: "Oil palm fruit",
      plantingWindow: "April – June (new plantings)",
      harvestWindow: "Year-round, with peak fruiting typically March – August",
      notes: "The historic core of Nigeria's palm belt (Edo, Delta, Akwa Ibom, Rivers).",
    },
    {
      commodity: "Cassava",
      plantingWindow: "March – June",
      harvestWindow: "Continuous, 9–18 months after planting (not a single seasonal window)",
    },
    {
      commodity: "Cocoa beans",
      plantingWindow: "April – June (new fields)",
      harvestWindow: "October – January (main crop), April – July (lighter mid-crop)",
      notes: "Cross River's Ikom belt.",
    },
    {
      commodity: "Yams",
      plantingWindow: "February – April",
      harvestWindow: "August – October",
    },
    {
      commodity: "Plantains",
      plantingWindow: "March – June (new plantings)",
      harvestWindow: "Year-round, with peak harvest typically August – November",
      notes: "Bayelsa's riverine belt (Ogbia, Southern Ijaw).",
    },
  ],
};

// Keep every zone represented (even if a future edit removes one accidentally)
// and every entry's commodity spelled consistently — cheap to check at module
// load, same discipline as cluster-commodities.ts's assertCommoditiesAreTracked().
function assertEveryZoneCovered() {
  for (const zone of GEO_ZONES) {
    if (!CROP_CALENDAR[zone] || CROP_CALENDAR[zone].length === 0) {
      throw new Error(`calendar-data.ts: geo-zone "${zone}" has no crop calendar entries.`);
    }
  }
}
assertEveryZoneCovered();

function assertCommoditiesAreTracked() {
  const trackedNames = new Set(TRACKED_COMMODITIES.map((c) => c.commodity));
  for (const [zone, entries] of Object.entries(CROP_CALENDAR)) {
    for (const entry of entries) {
      if (!trackedNames.has(entry.commodity)) {
        throw new Error(
          `calendar-data.ts: zone "${zone}" references commodity "${entry.commodity}", which is not in TRACKED_COMMODITIES (ingest-logic.ts).`
        );
      }
    }
  }
}
assertCommoditiesAreTracked();
