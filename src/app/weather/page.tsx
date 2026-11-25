import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import GicDashboard from "@/components/GicDashboard";
import type { DailyObservedReport } from "@/lib/types";

// ISR fallback alongside Supabase Realtime — a visitor landing between
// Realtime events still sees data no more than a minute stale.
export const revalidate = 60;

/**
 * The weather domain's own page — this is the content that used to be
 * mounted directly on "/" (see git history on src/app/page.tsx). Moved here
 * so "/" can become the GIC landing page with a domain picker (weather,
 * produce prices, produce stats, and so on), each domain now getting its
 * own page per the cross-cutting "every domain gets its own ... UI section"
 * commitment — extended here to mean its own route, not just its own card
 * on a shared page.
 *
 * The plain "← GIC Home" bar that used to sit above GicDashboard here is
 * gone as of 2026-11-25 — it was literally the piece of UI behind the
 * complaint that drove this change ("I click on weather I find it
 * difficult navigating around and when a[s] i want to see another
 * parameter I still have to navigate back to the landing page"):  a link
 * back to "/" was the ONLY way out of this page. AppShell now gives every
 * page, this one included, a persistent nav to every other domain
 * directly, not just Home, so that bar added nothing a real fix didn't
 * already cover.
 */
export default async function WeatherPage() {
  const supabase = getSupabaseBrowserClient();
  const { data: latestReport } = await supabase
    .from("daily_observed_reports")
    .select("*")
    .order("obs_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return <GicDashboard initialReport={latestReport as DailyObservedReport | null} />;
}
