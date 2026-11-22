/**
 * One-time bootstrap: create the first super_admin account.
 *
 * Deliberately NOT an API route or anything reachable over the web — the
 * only way this codebase ever creates a super_admin is by someone running
 * this script directly, with .env.local's SUPABASE_SERVICE_ROLE_KEY on
 * their own machine. /api/admin/accounts (the web UI's account-creation
 * endpoint) can only ever create role: "data_entry" accounts — see the
 * comment on CreateDataEntryAccountSchema in src/lib/auth/accounts-logic.ts
 * for why that split is the actual mass-assignment guard for super_admin.
 *
 * Usage:
 *   SUPER_ADMIN_EMAIL=you@growthlysolutions.com \
 *   SUPER_ADMIN_PASSWORD='choose-your-own-strong-password' \
 *   npm run seed:super-admin
 *
 * Safe to re-run: if a user_roles row already exists for that email, the
 * script reports it and exits without creating a duplicate or overwriting
 * anything.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!email || !password) {
    console.error(
      "Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD env vars before running this script."
    );
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("SUPER_ADMIN_PASSWORD must be at least 12 characters.");
    process.exit(1);
  }
  if (!url || !serviceRoleKey) {
    console.error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local."
    );
    process.exit(1);
  }

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  // Idempotency: don't create a second super_admin (or a confusing
  // duplicate auth user) if this has already been run for this email.
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const existing = existingUsers?.users.find((u) => u.email === email);

  let userId: string;

  if (existing) {
    const { data: existingRole } = await admin
      .from("user_roles")
      .select("role, active")
      .eq("user_id", existing.id)
      .maybeSingle();

    if (existingRole) {
      console.log(
        `Account for ${email} already exists with role "${existingRole.role}" ` +
          `(active: ${existingRole.active}). Nothing to do.`
      );
      return;
    }
    userId = existing.id;
    console.log(`Auth user for ${email} already exists with no role — assigning super_admin.`);
  } else {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      console.error("Failed to create auth user:", createError?.message);
      process.exit(1);
    }
    userId = created.user.id;
    console.log(`Created auth user for ${email}.`);
  }

  const { error: roleError } = await admin.from("user_roles").insert({
    user_id: userId,
    role: "super_admin",
    domain_scope: [],
    created_by: userId, // self-seeded — there is no earlier actor to attribute this to
    active: true,
  });

  if (roleError) {
    console.error("Failed to assign super_admin role:", roleError.message);
    process.exit(1);
  }

  console.log(`✅ ${email} is now a super_admin. Sign in at /login.`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
