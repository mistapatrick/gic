import { z } from "zod";
import { DATA_ENTRY_DOMAINS } from "@/lib/domains/registry";

/**
 * Validation for the "create a scoped data-entry account" request body.
 *
 * This schema is the Admin Mass-Assignment Guard for this endpoint: `role`
 * is not a field at all, so there is no value a caller can send — "admin",
 * "super_admin", true, anything — that grants more than a data_entry
 * account scoped to a known domain. The route handler (see
 * src/app/api/admin/accounts/route.ts) hardcodes role: "data_entry" itself;
 * it never reads a role out of the request body. The only way a second
 * super_admin account is ever created is scripts/seed-super-admin.ts, run
 * directly with the service-role key outside the web app — a deliberate
 * out-of-band step, not a button in the UI.
 */
export const CreateDataEntryAccountSchema = z.object({
  email: z.string().email(),
  domainScope: z
    .array(z.enum(DATA_ENTRY_DOMAINS))
    .min(1, "Select at least one data domain for this account"),
});

export type CreateDataEntryAccountInput = z.infer<typeof CreateDataEntryAccountSchema>;

export interface ValidationResult {
  ok: boolean;
  data?: CreateDataEntryAccountInput;
  error?: string;
}

/**
 * Parses and validates an unknown request body. Pulled out as a pure
 * function (no Supabase, no NextRequest) so it's unit-testable without
 * mocking the database — see tests/accounts-logic.test.ts.
 */
export function validateCreateAccountInput(body: unknown): ValidationResult {
  const parsed = CreateDataEntryAccountSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  return { ok: true, data: parsed.data };
}
