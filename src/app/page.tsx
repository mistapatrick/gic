import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import GicDashboard from "@/components/GicDashboard";
import type { DailyObservedReport } from "@/lib/types";

// ISR fallback alongside Supabase Realtime — a visitor landing between
// Realtime events still sees data no more than a minute stale.
export const revalidate = 60;

export default async function HomePage() {
  const supabase = getSupabaseBrowserClient();
  const { data: latestReport } = await supabase
    .from("daily_observed_reports")
    .select("*")
    .order("obs_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return <GicDashboard initialReport={latestReport as DailyObservedReport | null} />;
}
