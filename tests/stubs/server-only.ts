// Test-only stub for the "server-only" package (see vitest.config.ts alias).
// In real Next.js builds, the genuine package throws only when a "use
// client" bundle tries to import it; in plain Node (vitest) that condition
// never applies, so this stub is a no-op that lets server-only modules load
// under test.
export {};
