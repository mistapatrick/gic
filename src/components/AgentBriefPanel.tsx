"use client";

import React, { useState } from "react";
import { Sparkles, Send, Loader2, ChevronDown } from "lucide-react";
import { useAnalystChat } from "@/hooks/use-analyst-chat";
import type { DailyObservedReport } from "@/lib/types";

/**
 * AI observational synthesis + the interactive "Ask the analyst" Q&A drawer.
 * The drawer only ever sends plain text to /api/chat and only ever renders
 * plain text back through ordinary JSX expressions ({content}) — never
 * `dangerouslySetInnerHTML` — so nothing a user or the model produces can
 * execute as markup in the page (see tests/agent-brief-panel.test.tsx).
 */
export function AgentBriefPanel({ report }: { report: DailyObservedReport | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const { messages, sendMessage, isLoading, error, maxLength } = useAnalystChat();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || isLoading) return;
    void sendMessage(draft);
    setDraft("");
  };

  return (
    <section className="rounded-xl border border-brand-grey-green bg-brand-mint-pale/40 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-brand-teal" />
        <span className="text-xs font-bold uppercase tracking-wider text-brand-teal">
          AI Observational Synthesis (23:59 WAT)
        </span>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-brand-ink">
        {report?.national_summary ?? "Awaiting the next 23:59 WAT ingestion run."}
      </p>

      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-brand-teal/30 bg-brand-white px-3 py-1.5 text-xs font-semibold text-brand-teal hover:bg-brand-teal-soft"
        aria-expanded={isOpen}
      >
        Ask the analyst
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="mt-3 rounded-lg border border-brand-grey-green bg-brand-white p-3">
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {messages.length === 0 && (
              <p className="text-xs text-brand-muted">
                Ask about today&apos;s observed rainfall, temperature, humidity, wind, or
                sunshine across the 24 clusters — answers are grounded only in tonight&apos;s
                telemetry.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`rounded-md px-2.5 py-1.5 text-xs leading-relaxed ${
                  m.role === "user"
                    ? "ml-auto max-w-[85%] bg-brand-teal text-brand-white"
                    : "mr-auto max-w-[85%] bg-brand-grey-green text-brand-ink"
                }`}
              >
                {m.content}
              </div>
            ))}
            {isLoading && (
              <div className="flex items-center gap-1.5 text-xs text-brand-muted">
                <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
              </div>
            )}
          </div>

          {error && <p className="mt-2 text-xs text-metric-max-temp">{error}</p>}

          <form onSubmit={handleSubmit} className="mt-2 flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={maxLength}
              placeholder="e.g. Which cluster had the most rain today?"
              className="flex-1 rounded-lg border border-brand-grey-green bg-brand-white px-3 py-1.5 text-xs text-brand-ink placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-brand-teal/40"
            />
            <button
              type="submit"
              disabled={isLoading || !draft.trim()}
              aria-label="Send"
              className="rounded-lg bg-brand-teal p-2 text-brand-white disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
