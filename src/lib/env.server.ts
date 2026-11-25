import "server-only";
import { z } from "zod";

/**
 * Centralised, validated access to server-only environment variables.
 *
 * Importing this module from a "use client" component is a build-time error
 * (via the `server-only` package), so the service-role key and the AI/cron
 * secrets can never accidentally end up in a browser bundle.
 *
 * Validating with zod at first use means a missing/misconfigured secret
 * fails loudly and immediately (a 500 with a clear message in the server
 * logs) instead of surfacing later as a confusing downstream error.
 */
const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(10),
  GROQ_API_KEY: z.string().min(10),
  CRON_SECRET: z.string().min(16, "CRON_SECRET should be at least 16 characters — generate one with `openssl rand -hex 32`"),
});

type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getServerEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(
      `Missing or invalid environment variable(s): ${missing}. Check .env.local against .env.example.`
    );
  }
  cached = parsed.data;
  return cached;
}
