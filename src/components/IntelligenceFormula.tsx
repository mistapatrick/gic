import React from "react";

const STEPS = ["Data", "Insight", "Analytics", "Modelling", "Adaptation"];

/**
 * The landing page's core pitch, animated as a staggered reveal:
 * Data + Insight + Analytics + Modelling + Adaptation = Intelligence.
 * Pure CSS (see .gic-animate-in in globals.css) — no client JS, no
 * animation library, works the same on a slow connection or with
 * JavaScript disabled (it just appears instantly instead of staggering in,
 * same as the prefers-reduced-motion fallback already defined there).
 */
export function IntelligenceFormula() {
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-3 text-center"
      aria-label="Data plus Insight plus Analytics plus Modelling plus Adaptation equals Intelligence"
    >
      {STEPS.map((step, i) => (
        <React.Fragment key={step}>
          <span
            className="gic-animate-in rounded-full border border-brand-teal/25 bg-brand-mint-pale px-4 py-2 text-sm font-semibold text-brand-teal-dark sm:text-base"
            style={{ "--gic-delay": `${i * 0.18}s` } as React.CSSProperties}
          >
            {step}
          </span>
          {i < STEPS.length - 1 && (
            <span
              className="gic-animate-in text-lg font-bold text-brand-muted"
              style={{ "--gic-delay": `${i * 0.18 + 0.1}s` } as React.CSSProperties}
              aria-hidden="true"
            >
              +
            </span>
          )}
        </React.Fragment>
      ))}
      <span
        className="gic-animate-in text-lg font-bold text-brand-muted"
        style={{ "--gic-delay": `${STEPS.length * 0.18}s` } as React.CSSProperties}
        aria-hidden="true"
      >
        =
      </span>
      <span
        className="gic-animate-in rounded-full bg-brand-teal px-5 py-2 text-sm font-extrabold tracking-wide text-brand-white sm:text-base"
        style={{ "--gic-delay": `${STEPS.length * 0.18 + 0.2}s` } as React.CSSProperties}
      >
        Intelligence
      </span>
    </div>
  );
}
