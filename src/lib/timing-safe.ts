import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for secret-bearing headers (the ingest
 * route's CRON_SECRET bearer token). A plain `===` comparison leaks timing
 * information proportional to how many leading characters match, which is a
 * textbook (if slow) side-channel for guessing a secret byte-by-byte.
 * Returns false immediately — safely — on any length mismatch.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
