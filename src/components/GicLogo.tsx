"use client";

import React from "react";

/**
 * Growthly Intelligence Centre brand mark, in Growthly Nexus Solutions' own palette
 * (teal #005a5a / mint #93e9be) rather than the generic emerald/amber theme.
 * A rounded tile carries a mint pulse-accent circle, a pale-mint raindrop,
 * and a white telemetry waveform — agro-meteorological pulse, rain, and sun
 * in one mark, per the brand brief.
 */
export function GicLogo({
  className = "h-9 w-auto",
  showTagline = true,
}: {
  className?: string;
  /** False in the AppShell's sidebar/header reuse — "23:59 WAT Observed
   * Telemetry" is a weather-specific subtitle that would be misleading next
   * to, say, the admin panel or the commodity-prices page. */
  showTagline?: boolean;
}) {
  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <svg
        width="38"
        height="38"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
        aria-label="Growthly Intelligence Centre logo"
      >
        <defs>
          <linearGradient id="growthly-gic-bg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#007a7a" />
            <stop offset="100%" stopColor="#003f3f" />
          </linearGradient>
          <linearGradient id="growthly-gic-mint" x1="12" y1="6" x2="28" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#93e9be" />
            <stop offset="100%" stopColor="#6fd9a3" />
          </linearGradient>
        </defs>

        {/* Rounded tile */}
        <rect width="40" height="40" rx="10" fill="url(#growthly-gic-bg)" />

        {/* Mint pulse/solar accent */}
        <circle cx="26" cy="13" r="5" fill="url(#growthly-gic-mint)" />

        {/* Pale-mint raindrop accent */}
        <path
          d="M13 10c0 0 -4 5.4 -4 8.2c0 2.3 1.8 4.1 4 4.1c2.2 0 4 -1.8 4 -4.1c0 -2.8 -4 -8.2 -4 -8.2z"
          fill="#d4f6e5"
        />

        {/* Telemetry waveform / pulse line */}
        <path
          d="M5 28H12L15 22L19.5 33L23.5 25L26.5 28H35"
          stroke="#ffffff"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <div className="flex flex-col leading-none">
        <div className="flex items-center gap-1.5">
          <span className="text-base sm:text-lg font-extrabold tracking-tight text-brand-teal">
            GIC
          </span>
          <span className="rounded bg-brand-mint px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-brand-teal">
            NG
          </span>
        </div>
        {showTagline ? (
          <span className="text-[10px] sm:text-[11px] font-medium text-brand-ink-soft tracking-wide mt-0.5">
            23:59 WAT Observed Telemetry
          </span>
        ) : null}
      </div>
    </div>
  );
}
