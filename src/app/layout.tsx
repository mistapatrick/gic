import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Growthly Intelligence Centre | Growthly Nexus Solutions",
  description:
    "Continuously animated observed weather telemetry across 24 Nigerian agricultural clusters, updated nightly at 23:59 WAT. A Growthly Nexus Solutions data product.",
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

  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-brand-white text-brand-ink antialiased">
        {children}
      </body>
    </html>
  );
}
