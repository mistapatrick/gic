import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { withGeminiFallback } from "@/lib/ai-models";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";
import { ChatRequestSchema, buildChatSystemPrompt } from "@/lib/domains/weather/chat-logic";
import type { DailyObservedReport } from "@/lib/types";

export const dynamic = "force-dynamic";
// 60s is the Vercel Hobby plan's maxDuration ceiling. The AI call below gets
// a 40s budget (same as the ingest route's Gemini call), leaving ~20s of
// headroom for the Supabase read, JSON parsing and response write — the
// previous 30s/20s pairing left only ~10s of headroom and was observed in
// production to trip the 20s AbortSignal under normal Gemini latency.
export const maxDuration = 60;

const RATE_LIMIT = { limit: 10, windowMs: 60_000 }; // 10 requests / minute / client

export async function POST(req: NextRequest) {
  // 1. Rate limit first — cheapest possible rejection, before touching the
  //    database or spending an AI Studio free-tier quota call.
  const clientKey = getClientKey(req);
  const rl = checkRateLimit(`chat:${clientKey}`, RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil((rl.resetAt - Date.now()) / 1000).toString() },
      }
    );
  }

  // 2. Parse and strictly validate the request body. Reject anything that
  //    isn't valid JSON or doesn't match the schema before it ever reaches
  //    the model — this is the HTML/prompt-injection and abuse-size guard.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }
  const { message, history } = parsed.data;

  // 3. Fetch the latest (or a specific date's) report with the anon/read-only
  //    client — this endpoint never needs the service-role key.
  const supabase = getSupabaseBrowserClient();
  const { data: report } = await supabase
    .from("daily_observed_reports")
    .select("*")
    .order("obs_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const systemPrompt = buildChatSystemPrompt(report as DailyObservedReport | null);

  try {
    const result = await withGeminiFallback((model) =>
      generateText({
        model,
        system: systemPrompt,
        messages: [
          ...history.map((h) => ({ role: h.role, content: h.content }) as const),
          { role: "user" as const, content: message },
        ],
        abortSignal: AbortSignal.timeout(40_000),
      })
    );

    return NextResponse.json({ reply: result.text });
  } catch (err) {
    console.error("[chat] AI generation failed:", err);
    return NextResponse.json(
      { error: "The analyst is temporarily unavailable. Please try again shortly." },
      { status: 502 }
    );
  }
}
