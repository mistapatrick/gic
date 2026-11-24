import React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { GicLogo } from "./GicLogo";

/**
 * Shared sticky header for the per-domain pages (production conditions,
 * commodity prices) reached from the landing page's domain picker. Mirrors
 * GicDashboard's own header style (see GicDashboard.tsx) without touching
 * that component, since it's already live and tested as the weather page's
 * self-contained header.
 */
export function DomainPageHeader({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-brand-grey-green bg-brand-white/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <div className="flex items-center gap-3">
          <GicLogo />
          <span className="hidden text-brand-grey-green sm:inline">|</span>
          <span className="text-sm font-semibold text-brand-ink-soft">{title}</span>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-brand-grey-green px-3 py-1.5 text-xs font-medium text-brand-ink-soft hover:bg-brand-mint-pale sm:self-auto"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          GIC Home
        </Link>
      </div>
    </header>
  );
}
