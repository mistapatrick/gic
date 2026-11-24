import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
 */
export default async function WeatherPage() {
  const supabase = getSupabaseBrowserClient();
  const { data: latestReport } = await supabase
    .from("daily_observed_reports")
    .select("*")
    .order("obs_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <>
      {/* Plain (non-sticky) bar above GicDashboard's own sticky header, so
          the two never compete for the same fixed position — this scrolls
          away with the page, and GicDashboard's header takes over the top
          of the viewport from there, same as it always has. Kept outside
          GicDashboard itself so that already-tested component doesn't need
          to change now that it's no longer the top-level page. */}
      <div className="border-b border-brand-grey-green bg-brand-white px-4 py-1.5 lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-medium text-brand-ink-soft hover:bg-brand-mint-pale"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          GIC Home
        </Link>
      </div>
      <GicDashboard initialReport={latestReport as DailyObservedReport | null} />
    </>
  );
}
