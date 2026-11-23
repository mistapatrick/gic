import { z } from "zod";
import { DATA_ENTRY_DOMAINS } from "@/lib/domains/registry";
import { getManualEntryPayloadSchema } from "@/lib/domains/manual-entries/registry";

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/**
 * Envelope every manual-entry submission must satisfy, regardless of
 * domain. `payload` is intentionally z.unknown() here — its real shape is
 * validated separately, against the domain-specific schema from
 * MANUAL_ENTRY_PAYLOAD_SCHEMAS, once the domain itself is known to be
 * valid. Two-stage validation (envelope, then payload) is what lets this
 * one function serve every present and future manual-entry domain.
 */
const ManualEntrySubmissionEnvelopeSchema = z.object({
  domain: z.enum(DATA_ENTRY_DOMAINS),
  entryDate: DateString,
  sourceNote: z.string().trim().max(500).optional(),
  payload: z.unknown(),
});

export interface ValidatedManualEntrySubmission {
  domain: string;
  entryDate: string;
  sourceNote?: string;
  payload: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;
  data?: ValidatedManualEntrySubmission;
  error?: string;
}

/**
 * Pure, side-effect-free validation (no Supabase, no NextRequest) — see
 * tests/manual-entries-submission.test.ts. Mirrors the two existing
 * "validate*Input" pure functions (accounts-logic.ts,
 * backfill-request.ts) so every POST-body validator in this codebase
 * follows the same shape: parse, return {ok, data?, error?}, let the route
 * handler decide what to do with a failure (including audit-logging it).
 */
export function validateManualEntrySubmission(body: unknown): ValidationResult {
  const envelope = ManualEntrySubmissionEnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    return { ok: false, error: envelope.error.issues.map((i) => i.message).join("; ") };
  }

  const payloadSchema = getManualEntryPayloadSchema(envelope.data.domain);
  if (!payloadSchema) {
    return {
      ok: false,
      error: `Domain "${envelope.data.domain}" has no manual-entry form built yet`,
    };
  }

  const payload = payloadSchema.safeParse(envelope.data.payload);
  if (!payload.success) {
    return { ok: false, error: payload.error.issues.map((i) => i.message).join("; ") };
  }

  return {
    ok: true,
    data: {
      domain: envelope.data.domain,
      entryDate: envelope.data.entryDate,
      sourceNote: envelope.data.sourceNote,
      payload: payload.data as Record<string, unknown>,
    },
  };
}
