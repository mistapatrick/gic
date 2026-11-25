/**
 * Decorative per-commodity presentation metadata (see TRACKED_COMMODITIES in
 * ingest-logic.ts for the authoritative list both maps here must stay in
 * sync with) — an emoji and a grouping category, both purely cosmetic.
 * Used by ProductionConditionsCard to make the per-commodity grid easier to
 * scan at a glance; neither is ever the sole way a commodity is identified
 * (the commodity name label always sits next to the emoji, and the category
 * is a section heading, not a replacement for the name).
 *
 * Unicode has no dedicated emoji for several of these (cassava, yams, seed
 * cotton, sesame seed) — those four use the closest common visual
 * association rather than a literal match, documented inline below.
 */
const CROP_EMOJI: Record<string, string> = {
  Maize: "\u{1F33D}", // ear of maize
  "Rice (paddy)": "\u{1F33E}", // sheaf of rice
  Sorghum: "\u{1F33F}", // herb (closest: no sorghum-specific emoji)
  Millet: "\u{1F331}", // seedling (closest: no millet-specific emoji)
  Cassava: "\u{1F954}", // potato (closest common tuber emoji)
  Yams: "\u{1F360}", // roasted sweet potato (closest common tuber emoji)
  Cowpeas: "\u{1FAD8}", // beans
  Groundnuts: "\u{1F95C}", // peanuts
  "Soya beans": "\u{1FADB}", // pea pod (closest legume-pod emoji)
  "Cocoa beans": "\u{1F36B}", // chocolate bar (closest common association)
  "Oil palm fruit": "\u{1F334}", // palm tree
  "Seed cotton": "\u{2601}\u{FE0F}", // cloud (common informal stand-in for cotton)
  "Sesame seed": "\u{1F33B}", // sunflower (closest common oilseed-plant association)
  "Cattle meat": "\u{1F404}", // cow
  "Cow milk": "\u{1F95B}", // glass of milk
};

const DEFAULT_EMOJI = "\u{1F331}"; // seedling — fallback for any untracked/future commodity

export function getCropEmoji(commodity: string): string {
  return CROP_EMOJI[commodity] ?? DEFAULT_EMOJI;
}

export const CROP_CATEGORIES = [
  "Cereals",
  "Roots & tubers",
  "Legumes & oilseeds",
  "Cash crops",
  "Livestock products",
  "Other",
] as const;
export type CropCategory = (typeof CROP_CATEGORIES)[number];

const CROP_CATEGORY: Record<string, CropCategory> = {
  Maize: "Cereals",
  "Rice (paddy)": "Cereals",
  Sorghum: "Cereals",
  Millet: "Cereals",
  Cassava: "Roots & tubers",
  Yams: "Roots & tubers",
  Cowpeas: "Legumes & oilseeds",
  Groundnuts: "Legumes & oilseeds",
  "Soya beans": "Legumes & oilseeds",
  "Sesame seed": "Legumes & oilseeds",
  "Cocoa beans": "Cash crops",
  "Oil palm fruit": "Cash crops",
  "Seed cotton": "Cash crops",
  "Cattle meat": "Livestock products",
  "Cow milk": "Livestock products",
};

export function getCropCategory(commodity: string): CropCategory {
  return CROP_CATEGORY[commodity] ?? "Other";
}
