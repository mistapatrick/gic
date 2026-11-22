import { describe, expect, it } from "vitest";
import { validateCreateAccountInput } from "@/lib/auth/accounts-logic";

describe("validateCreateAccountInput", () => {
  it("accepts a valid email with one known domain", () => {
    const result = validateCreateAccountInput({
      email: "entry@growthlysolutions.com",
      domainScope: ["input_pricing"],
    });
    expect(result.ok).toBe(true);
    expect(result.data?.domainScope).toEqual(["input_pricing"]);
  });

  it("accepts multiple known domains", () => {
    const result = validateCreateAccountInput({
      email: "entry@growthlysolutions.com",
      domainScope: ["input_pricing", "crop_pest_tracking"],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a missing email", () => {
    const result = validateCreateAccountInput({ domainScope: ["input_pricing"] });
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed email", () => {
    const result = validateCreateAccountInput({
      email: "not-an-email",
      domainScope: ["input_pricing"],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty domainScope array", () => {
    const result = validateCreateAccountInput({
      email: "entry@growthlysolutions.com",
      domainScope: [],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown domain", () => {
    const result = validateCreateAccountInput({
      email: "entry@growthlysolutions.com",
      domainScope: ["made_up_domain"],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an attempt to smuggle a role field — mass-assignment guard", () => {
    // The schema has no `role` field at all, so even if a caller sends
    // one, zod strips it silently rather than accepting it: the route
    // handler never reads `role` off the body, it hardcodes
    // role: "data_entry" itself (see src/app/api/admin/accounts/route.ts).
    // This test documents that guarantee rather than exercising a branch
    // that could ever behave differently.
    const result = validateCreateAccountInput({
      email: "entry@growthlysolutions.com",
      domainScope: ["input_pricing"],
      role: "super_admin",
      is_admin: true,
    });
    expect(result.ok).toBe(true);
    expect(result.data).not.toHaveProperty("role");
    expect(result.data).not.toHaveProperty("is_admin");
  });

  it("rejects a completely malformed body", () => {
    expect(validateCreateAccountInput(null).ok).toBe(false);
    expect(validateCreateAccountInput("a string").ok).toBe(false);
    expect(validateCreateAccountInput(42).ok).toBe(false);
  });
});
