"use client";

import { Component, type ReactNode } from "react";

interface Props {
  domainLabel: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * React error boundaries must be class components — there is no hooks
 * equivalent for catching a render-time exception in a child subtree.
 * Wraps each new Sub-phase 2 dashboard card (ProductionConditionsCard,
 * CommodityPricesCard) individually in src/app/page.tsx so a render-time
 * bug in one card can never take down its sibling card, the main weather
 * dashboard, or the page — the "each failing independently of weather and
 * of each other" modularity rule applied to render failures specifically,
 * not just fetch failures (each card already handles its own fetch
 * errors internally with local state).
 */
export class DomainCardErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[${this.props.domainLabel}] card failed to render:`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-brand-grey-green bg-brand-white p-4 text-sm text-brand-muted shadow-sm">
          {this.props.domainLabel} is temporarily unavailable.
        </div>
      );
    }
    return this.props.children;
  }
}
