"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  CloudRain,
  Tag,
  Sprout,
  HeartPulse,
  LayoutDashboard,
  ShieldCheck,
  LogIn,
  MapPin,
  CalendarDays,
} from "lucide-react";
import { GicLogo } from "./GicLogo";
import { SignOutButton } from "./SignOutButton";
import { Footer } from "./Footer";
import type { DomainStatus } from "./DomainPicker";

/**
 * The persistent app-wide navigation shell — added 2026-11-25 in direct
 * response to UI/UX feedback: GIC previously had no shared layout at all
 * (src/app/layout.tsx rendered only `{children}`), so every domain page was
 * an island reachable only via a single "← GIC Home" link. Jumping from
 * Weather to Produce Prices meant going all the way back to "/" every time.
 *
 * Two responsive layouts from one shared NAV_ITEMS list, not a single
 * layout that squeezes down:
 *   - lg and up: a fixed left sidebar, wide enough that a 65" external
 *     monitor doesn't just get a mobile-width column floating in a sea of
 *     unused space — every domain is one click away, always visible.
 *   - below lg: a fixed bottom tab bar (not a hamburger drawer) — the
 *     mental model a housewife checking commodity prices, a trader, and an
 *     FMCG supply-chain manager all already share from every native phone
 *     app they use daily, which a hidden hamburger menu does not offer as
 *     readily. Capped at 5 items (Home, Weather, Prices, Stats, Account) to
 *     stay thumb-friendly; Food Security and every not-yet-live domain stay
 *     reachable via Home's own DomainPicker grid rather than crowding the
 *     bar further — the sidebar has room to list Food Security directly
 *     since desktop doesn't face the same space pressure.
 *
 * Deliberately a client component (needs usePathname() for the active-state
 * highlight) that receives role/feature-flag data as plain props from the
 * (server) root layout, rather than fetching anything itself.
 */

export interface AppShellProps {
  role: "super_admin" | "data_entry" | null;
  isAuthenticated: boolean;
  domainStatus: {
    commodityPrices: DomainStatus;
    productionConditions: DomainStatus;
    foodSecurity: DomainStatus;
    geoIntelligence: DomainStatus;
    cropCalendar: DomainStatus;
  };
  children: React.ReactNode;
}

interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: typeof Home;
  status?: DomainStatus;
  /** Only rendered in the sidebar (desktop has the room; the 5-slot bottom
   * bar does not). */
  sidebarOnly?: boolean;
}

function buildNavItems(props: AppShellProps): NavItem[] {
  const accountItem: NavItem = props.isAuthenticated
    ? props.role === "super_admin"
      ? { key: "account", label: "Admin", href: "/admin", icon: ShieldCheck }
      : { key: "account", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }
    : { key: "account", label: "Sign in", href: "/login", icon: LogIn };

  return [
    { key: "home", label: "Home", href: "/", icon: Home },
    { key: "weather", label: "Weather", href: "/weather", icon: CloudRain, status: "live" },
    {
      key: "commodity_prices",
      label: "Prices",
      href: "/commodity-prices",
      icon: Tag,
      status: props.domainStatus.commodityPrices,
    },
    {
      key: "production_conditions",
      label: "Stats",
      href: "/production-conditions",
      icon: Sprout,
      status: props.domainStatus.productionConditions,
    },
    {
      key: "food_security",
      label: "Food security",
      href: "/food-security",
      icon: HeartPulse,
      status: props.domainStatus.foodSecurity,
      sidebarOnly: true,
    },
    {
      key: "geo_intelligence",
      label: "Geo intelligence",
      href: "/geo-intelligence",
      icon: MapPin,
      status: props.domainStatus.geoIntelligence,
      sidebarOnly: true,
    },
    {
      key: "crop_calendar",
      label: "Crop calendar",
      href: "/crop-calendar",
      icon: CalendarDays,
      status: props.domainStatus.cropCalendar,
      sidebarOnly: true,
    },
    accountItem,
  ];
}

/** A small dot, not a full DomainPicker-style badge — the sidebar/bottom bar
 * is a quick-access rail, not the place to re-explain build status in words;
 * Home's DomainPicker already does that in full. */
function StatusDot({ status }: { status?: DomainStatus }) {
  if (!status || status === "live") return null;
  return (
    <span
      className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-status-watch"
      aria-label={status === "preview" ? "Launching soon" : "Planned"}
      title={status === "preview" ? "Launching soon" : "Planned"}
    />
  );
}

export function AppShell(props: AppShellProps) {
  const pathname = usePathname();
  const items = buildNavItems(props);
  const sidebarItems = items;
  const bottomBarItems = items.filter((item) => !item.sidebarOnly);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="min-h-screen bg-brand-white">
      {/* Desktop sidebar */}
      <nav
        aria-label="Primary"
        className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-brand-grey-green bg-brand-white lg:flex"
      >
        <Link href="/" className="flex items-center border-b border-brand-grey-green px-5 py-4">
          <GicLogo showTagline={false} />
        </Link>
        <ul className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <li key={item.key} className="relative">
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    active
                      ? "bg-brand-teal text-brand-white"
                      : "text-brand-ink-soft hover:bg-brand-mint-pale hover:text-brand-ink"
                  }`}
                >
                  <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
                  {item.label}
                  {item.status && item.status !== "live" && !active ? (
                    <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-status-watch" aria-hidden="true" />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
        {props.isAuthenticated ? (
          <div className="border-t border-brand-grey-green p-3">
            <SignOutButton />
          </div>
        ) : null}
      </nav>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-brand-grey-green bg-brand-white/95 backdrop-blur-md lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {bottomBarItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.key}
              href={item.href}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium ${
                active ? "text-brand-teal" : "text-brand-ink-soft"
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {item.label}
              <StatusDot status={item.status} />
            </Link>
          );
        })}
      </nav>

      {/* Content */}
      <div className="flex min-h-screen flex-col pb-16 lg:pb-0 lg:pl-60">
        <div className="flex-1">{props.children}</div>
        <Footer />
      </div>
    </div>
  );
}
