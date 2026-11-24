import React from "react";

/**
 * Large landing-page lockup of the GIC mark — same tile, gradient, and
 * pulse/raindrop/waveform concept as the compact GicLogo used in the
 * dashboard headers (see GicLogo.tsx), just scaled up and paired with the
 * full product name instead of the "GIC · NG" compact wordmark. Kept as a
 * separate component rather than overloading GicLogo with a size prop, so
 * the already-live, tested dashboard header can't regress from a landing
 * page change.
 */
export function GicHero({ className = "" }: { className?: string }) {
  return (
    <div className={`inline-flex items-center gap-4 select-none ${className}`}>
      <svg
        width="72"
        height="72"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 drop-shadow-sm"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="gic-hero-bg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#007a7a" />
            <stop offset="100%" stopColor="#003f3f" />
          </linearGradient>
          <linearGradient id="gic-hero-mint" x1="12" y1="6" x2="28" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#93e9be" />
            <stop offset="100%" stopColor="#6fd9a3" />
          </linearGradient>
        </defs>
        <rect width="40" height="40" rx="10" fill="url(#gic-hero-bg)" />
        <circle cx="26" cy="13" r="5" fill="url(#gic-hero-mint)" />
        {/* Small leaf pair — the one deliberate nod to the parent Growthly
            Nexus wordmark's tree mark, kept small enough that this stays
            clearly its own data-product identity rather than a redraw of
            the parent brand's tree. */}
        <path d="M23 9c-2 -1.5 -4 0 -3.4 2.3c1.8 0.3 3.8 -0.6 3.4 -2.3z" fill="#6fd9a3" />
        <path d="M29 9c2 -1.5 4 0 3.4 2.3c-1.8 0.3 -3.8 -0.6 -3.4 -2.3z" fill="#6fd9a3" />
        <path
          d="M13 10c0 0 -4 5.4 -4 8.2c0 2.3 1.8 4.1 4 4.1c2.2 0 4 -1.8 4 -4.1c0 -2.8 -4 -8.2 -4 -8.2z"
          fill="#d4f6e5"
        />
        <path
          d="M5 28H12L15 22L19.5 33L23.5 25L26.5 28H35"
          stroke="#ffffff"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <div className="flex flex-col leading-tight">
        <span className="text-2xl font-extrabold tracking-tight text-brand-teal-dark sm:text-3xl">
          Growthly Intelligence Centre
        </span>
        <span className="text-xs font-medium tracking-wide text-brand-muted sm:text-sm">
          A Growthly Nexus Solutions data product
        </span>
      </div>
    </div>
  );
}
