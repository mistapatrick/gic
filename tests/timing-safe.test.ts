import { describe, expect, it } from "vitest";
import { timingSafeStringEqual } from "@/lib/timing-safe";

describe("timingSafeStringEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeStringEqual("Bearer abc123", "Bearer abc123")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(timingSafeStringEqual("Bearer abc123", "Bearer abc124")).toBe(false);
  });

  it("returns false (not throw) for strings of different lengths", () => {
    expect(() => timingSafeStringEqual("short", "a-much-longer-string")).not.toThrow();
    expect(timingSafeStringEqual("short", "a-much-longer-string")).toBe(false);
  });

  it("treats empty strings consistently", () => {
    expect(timingSafeStringEqual("", "")).toBe(true);
    expect(timingSafeStringEqual("", "x")).toBe(false);
  });
});
