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
  // Cassava and Yams were reassigned 2026-11-27 (originally the potato and
  // roasted-sweet-potato emoji respectively, borrowed as "closest common
  // tuber" stand-ins) — those two emoji now belong to the real Potatoes and
  // Sweet potatoes entries added below, so reusing them here would show an
  // identical icon for two different tracked commodities in the same
  // "Roots & tubers" category.
  Cassava: "\u{1FAD3}", // flatbread (closest common association via cassava-flour staples like garri/fufu — no cassava-specific emoji exists)
  Yams: "\u{1F9C5}", // onion (closest common root-vegetable stand-in — no yam-specific emoji exists)
  Cowpeas: "\u{1FAD8}", // beans
  Groundnuts: "\u{1F95C}", // peanuts
  "Soya beans": "\u{1FADB}", // pea pod (closest legume-pod emoji)
  "Cocoa beans": "\u{1F36B}", // chocolate bar (closest common association)
  "Oil palm fruit": "\u{1F334}", // palm tree
  "Seed cotton": "\u{2601}\u{FE0F}", // cloud (common informal stand-in for cotton)
  "Sesame seed": "\u{1F33B}", // sunflower (closest common oilseed-plant association)
  "Cattle meat": "\u{1F404}", // cow
  "Cow milk": "\u{1F95B}", // glass of milk
  // Added 2026-11-26 alongside TRACKED_COMMODITIES in ingest-logic.ts.
  Bananas: "\u{1F34C}", // banana
  "Cashew nuts": "\u{1F330}", // chestnut (closest common nut emoji — no cashew-specific emoji exists)
  Ginger: "\u{1FADA}", // ginger root
  Plantains: "\u{1F34C}", // banana (closest common association, same as Bananas — no plantain-specific emoji exists)
  // Added 2026-11-27 alongside TRACKED_COMMODITIES in ingest-logic.ts.
  Cashewapple: "\u{1F34E}", // red apple (closest common association — the name itself references "apple"; no cashew-apple-specific emoji exists)
  "Shea nuts": "\u{1F330}", // chestnut (closest common nut emoji, same as Cashew nuts — no shea-specific emoji exists)
  "Carrots and turnips": "\u{1F955}", // carrot
  Cabbages: "\u{1F96C}", // leafy green (no cabbage-specific emoji exists)
  "Lettuce and chicory": "\u{1F96C}", // leafy green (same as Cabbages — no lettuce-specific emoji exists)
  Watermelons: "\u{1F349}", // watermelon
  Melonseed: "\u{1F348}", // melon (closest common association — the fruit it comes from; no seed-specific emoji exists)
  Tomatoes: "\u{1F345}", // tomato
  "Chillies and peppers, green": "\u{1FAD1}", // bell pepper
  "Sweet potatoes": "\u{1F360}", // roasted sweet potato
  Potatoes: "\u{1F954}", // potato
  Pineapples: "\u{1F34D}", // pineapple
  Oranges: "\u{1F34A}", // tangerine (closest common citrus emoji)
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
  "Fruits & vegetables",
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
  // Added 2026-11-26 alongside TRACKED_COMMODITIES in ingest-logic.ts.
  "Cashew nuts": "Cash crops", // export tree crop, same grouping as Cocoa beans/Oil palm fruit
  Ginger: "Cash crops", // export spice crop
  // Bananas and Plantains were reassigned 2026-11-27, from "Other" (via the
  // fallback below) to the new "Fruits & vegetables" category added above
  // — this round's much larger batch of fresh-produce items made a
  // dedicated category worth adding, rather than leaving a growing list of
  // fruits and vegetables all falling through to "Other".
  Bananas: "Fruits & vegetables",
  Plantains: "Fruits & vegetables",
  // Added 2026-11-27 alongside TRACKED_COMMODITIES in ingest-logic.ts.
  Cashewapple: "Fruits & vegetables", // the fresh fruit; "Cashew nuts" above stays in Cash crops (the export commodity)
  "Shea nuts": "Cash crops", // export nut crop, same grouping as Cashew nuts/Cocoa beans/Oil palm fruit
  "Carrots and turnips": "Fruits & vegetables",
  Cabbages: "Fruits & vegetables",
  "Lettuce and chicory": "Fruits & vegetables",
  Watermelons: "Fruits & vegetables",
  Melonseed: "Legumes & oilseeds", // FAOSTAT classes it as an oilseed, same grouping as Groundnuts/Soya beans/Sesame seed
  Tomatoes: "Fruits & vegetables",
  "Chillies and peppers, green": "Fruits & vegetables",
  "Sweet potatoes": "Roots & tubers",
  Potatoes: "Roots & tubers",
  Pineapples: "Fruits & vegetables",
  Oranges: "Fruits & vegetables",
};

export function getCropCategory(commodity: string): CropCategory {
  return CROP_CATEGORY[commodity] ?? "Other";
}
