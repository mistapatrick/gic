import React from "react";

/**
 * The single shared footer, added 2026-11-25 in direct response to a UI/UX
 * requirement given verbatim: the exact text below "at the footer of each
 * page." Previously two near-duplicate, divergent footers existed
 * (page.tsx and GicDashboard.tsx), both missing the email address, and
 * every other page (login, admin, dashboard, the three other domain pages)
 * had none at all. Rendered once, from AppShell, so every route gets the
 * identical text with no risk of drift between pages.
 */
export function Footer() {
  return (
    <footer className="border-t border-brand-grey-green px-4 py-6 text-center text-[11px] text-brand-muted">
      A Growthly Nexus Solutions Limited data product • growthlysolutions.com • hello@growthlysolutions.com
    </footer>
  );
}
