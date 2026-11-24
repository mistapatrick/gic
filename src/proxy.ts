import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PAGE_PREFIXES = ["/admin", "/dashboard"];
// /api/manual-entries is used by BOTH super_admin (reviewing submissions)
// and data_entry accounts (submitting their own) — unlike /api/admin, it
// is not restricted to super_admin at this layer (see the role-specific
// check further down, which only narrows /api/admin). Gating it here still
// means an unauthenticated or deactivated caller never reaches the route
// handler's own checks or Postgres RLS at all, matching the "defense in
// depth, not a replacement" principle this file documents below.
const PROTECTED_API_PREFIXES = ["/api/admin", "/api/manual-entries"];

/**
 * Builds a per-request Content-Security-Policy using a freshly generated
 * nonce. script-src uses 'nonce-<value>' + 'strict-dynamic' — Next's own
 * documented pattern for the App Router (nextjs.org/docs/app/guides/
 * content-security-policy) — because Turbopack's runtime chunk loader
 * dynamically creates <script> elements for code-split chunks at runtime;
 * 'strict-dynamic' is what lets a script Next already trusts (via the
 * nonce) load further scripts it creates, without which every lazy chunk
 * would be silently blocked. The bare 'self' token is kept alongside the
 * nonce purely as a fallback for the small number of browsers that don't
 * understand nonce-source/strict-dynamic — spec-compliant browsers ignore
 * it once a nonce is present.
 *
 * style-src keeps 'unsafe-inline' deliberately: a nonce can be attached to
 * a <style> element, but CSP has no mechanism to nonce a plain element's
 * `style=""` attribute (e.g. the backfill progress bar's inline width in
 * src/components/BackfillPanel.tsx) — only 'unsafe-inline' covers that
 * case. This is a narrower, well-documented trade-off (CSS can't execute
 * script) than relaxing script-src would be, which is why the two
 * directives are not treated the same.
 */
function buildCsp(nonce: string): string {
  let supabaseHttp = "";
  let supabaseWs = "";
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (supabaseUrl) {
      const host = new URL(supabaseUrl).host;
      supabaseHttp = `https://${host}`;
      supabaseWs = `wss://${host}`;
    }
  } catch {
    // Misconfigured/missing NEXT_PUBLIC_SUPABASE_URL — fall back to a CSP
    // with no Supabase host allowed rather than throwing; getServerEnv()
    // elsewhere in the app is what surfaces that misconfiguration loudly.
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${supabaseHttp} ${supabaseWs}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function newNonce(): string {
  // Base64 of a random UUID — matches the character set Next.js's own
  // nonce extractor expects (see node_modules/next/dist/server/app-render/
  // get-script-nonce-from-header.js: /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/).
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

function withSecurityHeaders(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/**
 * Next.js 16's "proxy" convention (the renamed successor to the old
 * middleware.ts/middleware() — see the build-time deprecation notice this
 * replaced). Runs on every request (see the matcher below) for two
 * unrelated jobs:
 *
 * 1. Content-Security-Policy, with a fresh per-request nonce forwarded to
 *    Next's renderer via the request headers — this is what the "Secure
 *    Headers & CSP" checklist item means in practice. The other static
 *    security headers (X-Frame-Options, HSTS, etc., which don't need a
 *    nonce) live in next.config.ts instead; CSP has to be set here because
 *    it's the only layer that runs before every request with the nonce
 *    freshly generated.
 * 2. Session refresh + access gating for /admin, /dashboard, and
 *    /api/admin — see the detailed comment this had as middleware.ts
 *    below. This part only runs its Supabase calls for those prefixes;
 *    every other path (the public dashboard, /login, /api/ingest, /api/chat,
 *    /api/export) gets the CSP header and nothing else from this file.
 *
 * Two jobs under (2), both required:
 *
 * a. Refresh the Supabase session cookie. Server Components cannot write
 *    cookies (Next.js forbids it outside Route Handlers/Server Actions), so
 *    without this, a session nearing expiry would never get refreshed and
 *    users would be silently logged out. This is the standard
 *    @supabase/ssr Next.js pattern.
 * b. Gate access: unauthenticated or inactive/un-roled users are redirected
 *    (pages) or sent a 401 (API routes) before the request ever reaches a
 *    page or route handler. This is defense in depth on top of each route's
 *    own checks and Postgres RLS, not a replacement for either — a route
 *    handler must still use getSupabaseServerClient()/RLS, never trust the
 *    request just because it passed the proxy.
 *
 * NEVER rely on supabase.auth.getSession() here for an authorization
 * decision — it reads the (possibly stale/forged) cookie without
 * contacting the Auth server. getUser() revalidates the JWT on every call,
 * which is what makes this gate meaningful.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isProtectedPage = PROTECTED_PAGE_PREFIXES.some((p) => path.startsWith(p));
  const isProtectedApi = PROTECTED_API_PREFIXES.some((p) => path.startsWith(p));

  const nonce = newNonce();
  const csp = buildCsp(nonce);

  // Forward both the nonce and the CSP header on the REQUEST (not just the
  // response) — Next's renderer reads the nonce back out of the request's
  // own Content-Security-Policy header to stamp it onto every script tag
  // it injects server-side. Without this forwarding step the nonce in the
  // response header is cosmetic only and every Next-generated inline
  // script gets blocked by real browsers.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  // Every request on the matcher below gets the CSP header. The Supabase
  // session refresh + role check that follows is real I/O (a call out to
  // Supabase Auth, then a database query) and is only ever needed for the
  // handful of paths that actually require a signed-in role — running it
  // unconditionally would mean a Supabase round-trip on every public
  // dashboard view and, worse, on every /api/ingest cron hit (which
  // authenticates with a bearer token, not a session, and has nothing to
  // do with Supabase Auth at all). Bail out here before any Supabase
  // client is even constructed for non-protected paths.
  if (!isProtectedPage && !isProtectedApi) {
    return withSecurityHeaders(response, csp);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    // Misconfigured env — fail closed on protected paths rather than
    // letting an unauthenticated request through.
    const failClosed = isProtectedApi
      ? NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
      : NextResponse.redirect(new URL("/login", request.url));
    return withSecurityHeaders(failClosed, csp);
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    const unauthenticated = isProtectedApi
      ? NextResponse.json({ error: "Not authenticated" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url));
    return withSecurityHeaders(unauthenticated, csp);
  }

  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role, active")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (!roleRow || !roleRow.active) {
    const noAccess = isProtectedApi
      ? NextResponse.json({ error: "No active role assigned" }, { status: 403 })
      : NextResponse.redirect(new URL("/login?error=no_access", request.url));
    return withSecurityHeaders(noAccess, csp);
  }

  // /admin (account management) is super_admin only. A data_entry account
  // that tries it gets bounced to /dashboard, not a redirect loop to /login
  // (they ARE authenticated — they just can't manage accounts).
  if (path.startsWith("/admin") && roleRow.role !== "super_admin") {
    return withSecurityHeaders(NextResponse.redirect(new URL("/dashboard", request.url)), csp);
  }
  if (path.startsWith("/api/admin") && roleRow.role !== "super_admin") {
    return withSecurityHeaders(
      NextResponse.json({ error: "Super admin only" }, { status: 403 }),
      csp
    );
  }

  return withSecurityHeaders(response, csp);
}

export const config = {
  // Runs on every request except Next's own static chunks/images and
  // common static asset extensions — those don't need a per-request CSP
  // nonce or an auth check, and skipping them avoids pointless Supabase
  // calls when a page later also hits /admin or /dashboard.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
