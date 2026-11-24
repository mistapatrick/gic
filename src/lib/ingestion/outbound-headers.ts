/**
 * Shared headers for every outbound request this app makes to a third-party
 * government/institutional data source (FAOSTAT, NBS, World Bank RTFP).
 *
 * Until now, every one of those fetch() calls sent zero headers beyond
 * {cache, signal} — no User-Agent, no Accept, nothing identifying the
 * request at all. That's not just impolite: a request with no browser-like
 * User-Agent, arriving from Vercel's well-known serverless/datacenter IP
 * ranges, is a textbook pattern that origin-side security/anti-bot layers
 * commonly reject outright — which is one plausible explanation for the
 * production_conditions backfill's HTTP 521 from FAOSTAT (Cloudflare's
 * own code for "edge reached the hostname, but the actual origin behind it
 * refused or failed to respond" — consistent with a near-origin security
 * layer rejecting based on request characteristics, not with Cloudflare's
 * own edge-level bot challenge, which would typically show as 403/503
 * instead since that never even reaches origin).
 *
 * This is not asserted as the confirmed, sole cause of that 521 — this
 * sandbox has no way to verify FAOSTAT's live behavior before/after this
 * change — but sending an honest, identifying User-Agent is correct
 * regardless: it's the standard way a legitimate automated client
 * identifies itself to a public API, and it costs nothing if it turns out
 * not to be the fix.
 */
export const GIC_OUTBOUND_HEADERS: Record<string, string> = {
  "User-Agent":
    "GrowthlyIntelligenceCentre/1.0 (+https://gic-two.vercel.app; contact: yusuf@growthlysolutions.com)",
};
