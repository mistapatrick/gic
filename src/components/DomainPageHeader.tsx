import React from "react";
import { GicLogo } from "./GicLogo";

/**
 * Shared sticky header for the per-domain pages (production conditions,
 * commodity prices, food security) reached from the landing page's domain
 * picker. Mirrors GicDashboard's own header style (see GicDashboard.tsx)
 * without touching that component, since it's already live and tested as
 * the weather page's self-contained header.
 *
 * The "← GIC Home" back-link this header used to carry is gone as of
 * 2026-11-25: AppShell now gives every page a persistent Home nav item
 * (sidebar on desktop, bottom tab on mobile), so a second, page-local way
 * back to "/" was redundant chrome rather than a second real affordance.
 * Widened to max-w-7xl (from max-w-5xl) to match GicDashboard's own
 * container width, rather than each domain page settling on its own,
 * narrower width for no functional reason.
 */
export function DomainPageHeader({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-brand-grey-green bg-brand-white/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 lg:px-8">
        <GicLogo />
        <span className="hidden text-brand-grey-green sm:inline">|</span>
        <span className="text-sm font-semibold text-brand-ink-soft">{title}</span>
      </div>
    </header>
  );
}
