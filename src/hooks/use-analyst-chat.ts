"use client";

import { useCallback, useState } from "react";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const MAX_MESSAGE_LENGTH = 500;

/**
 * Minimal client-side chat state for the "Ask the analyst" drawer. Talks to
 * /api/chat with a plain fetch (no streaming) rather than `ai`'s `useChat`
 * hook: this codebase pins `ai` v7 without the separate `@ai-sdk/react`
 * package, and a small hand-rolled hook keeps the request/response shape
 * fully predictable and easy to unit test.
 */
export function useAnalystChat() {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (rawMessage: string) => {
      const message = rawMessage.trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!message) return;

      setError(null);
      const history = messages.slice(-6);
      setMessages((prev) => [...prev, { role: "user", content: message }]);
      setIsLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, history }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data?.error ?? "Something went wrong. Please try again.");
          return;
        }

        setMessages((prev) => [...prev, { role: "assistant", content: data.reply as string }]);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setIsLoading(false);
      }
    },
    [messages]
  );

  return { messages, sendMessage, isLoading, error, maxLength: MAX_MESSAGE_LENGTH };
}
