import React from "react";
import { Clock } from "lucide-react";

/**
 * Shown on a domain's own page (e.g. /production-conditions,
 * /commodity-prices) when that domain's feature_flags row is still off —
 * the ingestion and card are built, but not yet verified live in this
 * deployment (see each card's own "hidden entirely while disabled" comment).
 * An honest status page, not a dead end: says what's really going on
 * instead of silently rendering nothing.
 */
export function DomainComingSoon({ domainLabel }: { domainLabel: string }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-brand-grey-green bg-brand-white p-8 text-center shadow-sm">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-mint-pale text-brand-teal-dark">
        <Clock className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-brand-ink">{domainLabel} is almost ready</h2>
      <p className="mt-2 text-sm text-brand-ink-soft">
        The data pipeline for this domain is built and being verified against live data. It&apos;ll
        appear here automatically once that&apos;s confirmed — no action needed.
      </p>
    </div>
  );
}
