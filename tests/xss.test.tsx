import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AgentBriefPanel } from "@/components/AgentBriefPanel";
import type { DailyObservedReport } from "@/lib/types";

/**
 * HTML/script-injection check: the AI brief and the "Ask the analyst" chat
 * drawer only ever render strings through ordinary JSX text expressions
 * ({content}), never `dangerouslySetInnerHTML`. React escapes text content
 * by design, so even a string that *looks* like markup — from a malicious
 * user, or a compromised/unexpected model response — can never become a
 * live, executable element. These tests prove that end-to-end against the
 * real rendered DOM rather than just asserting "no dangerouslySetInnerHTML
 * in the source", which could silently regress if someone added one later.
 */

const SCRIPT_PAYLOAD = '<script>window.__pwned = true;</script>';
const IMG_PAYLOAD = '<img src=x onerror="window.__pwned = true">';

afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error -- test-only global check
  delete window.__pwned;
});

function baseReport(nationalSummary: string): DailyObservedReport {
  return {
    obs_date: "2026-03-10",
    cutoff_hour_wat: 21,
    national_summary: nationalSummary,
    regional_insights: [],
    cluster_metrics: [],
  };
}

describe("AgentBriefPanel — AI synthesis text is never parsed as HTML", () => {
  it("renders a <script>-bearing national_summary as inert visible text", () => {
    const { container } = render(<AgentBriefPanel report={baseReport(SCRIPT_PAYLOAD)} />);

    // The literal text IS shown to the user...
    expect(screen.getByText(SCRIPT_PAYLOAD)).toBeInTheDocument();
    // ...but no actual <script> element was ever created in the DOM.
    expect(container.querySelector("script")).toBeNull();
    // @ts-expect-error -- test-only global check
    expect(window.__pwned).toBeUndefined();
  });

  it("renders an onerror-image payload as inert visible text, not a live <img>", () => {
    const { container } = render(<AgentBriefPanel report={baseReport(IMG_PAYLOAD)} />);

    expect(screen.getByText(IMG_PAYLOAD)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    // @ts-expect-error -- test-only global check
    expect(window.__pwned).toBeUndefined();
  });
});

describe("AgentBriefPanel — Q&A drawer never executes user- or model-supplied markup", () => {
  it("echoes a malicious user message and a malicious AI reply as plain text only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ reply: IMG_PAYLOAD }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const { container } = render(<AgentBriefPanel report={baseReport("All quiet today.")} />);

    fireEvent.click(screen.getByRole("button", { name: /ask the analyst/i }));

    const input = screen.getByPlaceholderText(/which cluster had the most rain/i);
    fireEvent.change(input, { target: { value: SCRIPT_PAYLOAD } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    // User bubble: the malicious text the user "typed" is shown verbatim...
    expect(await screen.findByText(SCRIPT_PAYLOAD)).toBeInTheDocument();
    // ...and the mocked malicious assistant reply, once it resolves, likewise.
    expect(await screen.findByText(IMG_PAYLOAD)).toBeInTheDocument();

    // Neither ever became live markup.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    // @ts-expect-error -- test-only global check
    expect(window.__pwned).toBeUndefined();
  });

  it("sends the raw message to /api/chat as JSON data, never interpolated into markup/SQL", async () => {
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ reply: "12.4mm was observed." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentBriefPanel report={baseReport("All quiet today.")} />);
    fireEvent.click(screen.getByRole("button", { name: /ask the analyst/i }));

    const payload = "'; DROP TABLE weather_clusters; --";
    const input = screen.getByPlaceholderText(/which cluster had the most rain/i);
    fireEvent.change(input, { target: { value: payload } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    // The payload is carried as an ordinary JSON string field — never string-
    // concatenated into a query or a markup template.
    expect(body.message).toBe(payload);
  });
});
