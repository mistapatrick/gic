import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetTable?: string;
  targetId?: string;
  changedFields?: Record<string, unknown>;
  outcome: "success" | "failure";
}

/**
 * Writes one row to the append-only audit_log table. There is deliberately
 * no corresponding "update" or "delete" function — see the "no edit path
 * for anyone" comment on the audit_log table in
 * supabase/migrations/0002_auth_roles_audit.sql. Every admin-surface
 * mutation (account creation, deactivation, flag changes) must call this,
 * on both the success and the failure path, so the trail shows attempted
 * actions, not just completed ones.
 *
 * Uses the service-role client because audit_log has no insert policy for
 * anon/authenticated at all — only this server-side path can write to it,
 * which is what keeps the log honest (a compromised user session still
 * can't forge or suppress audit rows).
 *
 * Never throws: a failure to audit-log must never be allowed to crash or
 * block the action it's recording, but it is logged to the server console
 * so a persistent audit-write failure doesn't go unnoticed.
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const admin = getSupabaseAdminClient();
    const { error } = await admin.from("audit_log").insert({
      actor_id: entry.actorId,
      action: entry.action,
      target_table: entry.targetTable ?? null,
      target_id: entry.targetId ?? null,
      changed_fields: entry.changedFields ?? null,
      outcome: entry.outcome,
    });
    if (error) {
      console.error("[audit] failed to write audit_log row:", error.message, entry);
    }
  } catch (err) {
    console.error("[audit] unexpected error writing audit_log row:", err, entry);
  }
}
