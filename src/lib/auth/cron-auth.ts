import { timingSafeStringEqual } from "@/lib/timing-safe";

/**
 * Pure bearer-token check for the /api/ingest route, factored out so it can
 * be unit-tested without needing a real NextRequest or server-only env
 * loading (see tests/auth.test.ts).
 */
export function isAuthorizedBearer(
  authHeaderValue: string | null | undefined,
  cronSecret: string
): boolean {
  if (!authHeaderValue) return false;
  const expected = `Bearer ${cronSecret}`;
  return timingSafeStringEqual(authHeaderValue, expected);
}
