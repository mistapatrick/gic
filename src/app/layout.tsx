import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { AppShell } from "@/components/AppShell";
import { getCurrentUserRole } from "@/lib/supabase/server";
import { isFeatureEnabled } from "@/lib/feature-flags";
import "./globals.css";

export const metadata: Metadata = {
  title: "Growthly Intelligence Centre | Growthly Nexus Solutions",
  description:
    "Nigerian agricultural intelligence — weather, production conditions, and commodity prices, interpreted into decisions. A Growthly Nexus Solutions data product.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#005a5a",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Reading headers() here is NOT decorative — it's what makes every page
  // render dynamically (per request) instead of being statically
  // prerendered at build time. src/proxy.ts generates a fresh CSP nonce on
  // every request and forwards it via the request's Content-Security-Policy
  // header, which Next's renderer stamps onto every inline <script> it
  // injects — but ONLY for a dynamically-rendered request. A statically
  // prerendered page has no request to read a nonce from at all, so its
  // cached HTML's inline scripts would carry no nonce and a real browser
  // would block every one of them under the proxy's nonce-based CSP,
  // breaking hydration on exactly the static pages that look fine in curl.
  // This is Next's own documented fix for that
  // (nextjs.org/docs/app/guides/content-security-policy) — calling any
  // dynamic API in the root layout opts the whole app into per-request
  // rendering, so do not remove this without removing the nonce from
  // proxy.ts's CSP too.
  await headers();

  // Role and domain status feed the persistent AppShell nav (see that
  // component's own comment — added 2026-11-25 to replace the old
  // "every domain page is an island reachable only via its own back-link"
  // layout). Both calls already fail safe on their own (isFeatureEnabled
  // defaults to false; getCurrentUserRole returns null for "no session" or
  // "no role row"), but the root layout wraps literally every page with no
  // page-level error boundary above it — so an unexpected throw here (a
  // missing env var, a transient network error) must not 500 the whole
  // app. Worst case on failure: the shell renders as if signed out and
  // every domain shows "preview" instead of "live" — a cosmetic
  // degradation, never a crash.
  let role: Awaited<ReturnType<typeof getCurrentUserRole>> = null;
  try {
    role = await getCurrentUserRole();
  } catch {
    role = null;
  }

  let domainStatus = {
    commodityPrices: false,
    productionConditions: false,
    foodSecurity: false,
    geoIntelligence: false,
    cropCalendar: false,
  };
  try {
    const [commodityPrices, productionConditions, foodSecurity, geoIntelligence, cropCalendar] = await Promise.all([
      isFeatureEnabled("commodity_prices"),
      isFeatureEnabled("production_conditions"),
      isFeatureEnabled("food_security"),
      isFeatureEnabled("geo_intelligence"),
      isFeatureEnabled("crop_calendar"),
    ]);
    domainStatus = { commodityPrices, productionConditions, foodSecurity, geoIntelligence, cropCalendar };
  } catch {
    // keep the all-false default above
  }

  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-brand-white text-brand-ink antialiased">
        <AppShell
          role={role?.role ?? null}
          isAuthenticated={role !== null}
          domainStatus={{
            commodityPrices: domainStatus.commodityPrices ? "live" : "preview",
            productionConditions: domainStatus.productionConditions ? "live" : "preview",
            foodSecurity: domainStatus.foodSecurity ? "live" : "preview",
            geoIntelligence: domainStatus.geoIntelligence ? "live" : "preview",
            cropCalendar: domainStatus.cropCalendar ? "live" : "preview",
          }}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
