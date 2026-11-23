import { describe, expect, it } from "vitest";
import { validateManualEntrySubmission } from "@/lib/domains/manual-entries/submission";

const VALID_COMMODITY_PRICE_PAYLOAD = {
  commodity: "Rice (50kg bag)",
  market: "Kaduna Central Market",
  price: 65000,
  unit: "50kg bag",
  currency: "NGN",
  source: "NBS_HFP",
};

describe("validateManualEntrySubmission", () => {
  it("accepts a valid commodity_prices submission", () => {
    const result = validateManualEntrySubmission({
      domain: "commodity_prices",
      entryDate: "2026-11-20",
      payload: VALID_COMMODITY_PRICE_PAYLOAD,
    });
    expect(result.ok).toBe(true);
    expect(result.data?.payload.commodity).toBe("Rice (50kg bag)");
  });

  it("applies the payload schema's own defaults (market, currency)", () => {
    const result = validateManualEntrySubmission({
      domain: "commodity_prices",
      entryDate: "2026-11-20",
      payload: { commodity: "Maize", price: 500, unit: "kg", source: "OTHER" },
    });
    expect(result.ok).toBe(true);
    expect(result.data?.payload.market).toBe("National average");
    expect(result.data?.payload.currency).toBe("NGN");
  });

  it("rejects a domain that isn't in DATA_ENTRY_DOMAINS at all", () => {
    const result = validateManualEntrySubmission({
      domain: "made_up_domain",
      entryDate: "2026-11-20",
      payload: VALID_COMMODITY_PRICE_PAYLOAD,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a known reserved domain with no manual-entry form built yet", () => {
    const result = validateManualEntrySubmission({
      domain: "input_pricing",
      entryDate: "2026-11-20",
      payload: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no manual-entry form built yet/);
  });

  it("rejects a non-positive price", () => {
    const result = validateManualEntrySubmission({
      domain: "commodity_prices",
      entryDate: "2026-11-20",
      payload: { ...VALID_COMMODITY_PRICE_PAYLOAD, price: -5 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing commodity", () => {
    const result = validateManualEntrySubmission({
      domain: "commodity_prices",
      entryDate: "2026-11-20",
      payload: { ...VALID_COMMODITY_PRICE_PAYLOAD, commodity: "" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown source value", () => {
    const result = validateManualEntrySubmission({
      domain: "commodity_prices",
      entryDate: "2026-11-20",
      payload: { ...VALID_COMMODITY_PRICE_PAYLOAD, source: "MADE_UP_SOURCE" },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed entryDate", () => {
    const result = validateManualEntrySubmission({
      domain: "commodity_prices",
      entryDate: "20-11-2026",
      payload: VALID_COMMODITY_PRICE_PAYLOAD,
    });
    expect(result.ok).toBe(false);
  });
});
