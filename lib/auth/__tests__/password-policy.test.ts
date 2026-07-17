import { describe, it, expect } from "vitest";
import { validatePassword, isPasswordValid, PASSWORD_MIN, lockoutAfterFailure, MAX_LOGIN_ATTEMPTS, LOCKOUT_MINUTES } from "@/lib/auth/password-policy";

describe("validatePassword", () => {
  it("accepts a strong 12+ char password with all classes", () => {
    expect(validatePassword("Abcdef1!ghij")).toBeNull();
    expect(isPasswordValid("Str0ng#Passw0rd")).toBe(true);
  });

  it("rejects passwords shorter than the minimum", () => {
    expect(validatePassword("Ab1!xyz")).toMatch(new RegExp(`${PASSWORD_MIN}`));
    expect(isPasswordValid("Ab1!xyz")).toBe(false);
  });

  it("requires lower, upper, digit, and special", () => {
    expect(validatePassword("ABCDEF1!GHIJ")).toMatch(/صغير/); // no lowercase
    expect(validatePassword("abcdef1!ghij")).toMatch(/كبير/); // no uppercase
    expect(validatePassword("Abcdef!ghijk")).toMatch(/رقم/);  // no digit
    expect(validatePassword("Abcdef1ghijk")).toMatch(/رمز/);  // no special
  });

  it("rejects empty / whitespace-only", () => {
    expect(validatePassword("")).not.toBeNull();
    expect(isPasswordValid("            ")).toBe(false); // 12 spaces: length ok but no complexity
  });
});

describe("lockoutAfterFailure", () => {
  const now = Date.UTC(2026, 6, 18, 12, 0, 0);
  it("increments the counter without locking below the threshold", () => {
    const r = lockoutAfterFailure(3, now);
    expect(r.failedLoginAttempts).toBe(4);
    expect(r.lockedUntil).toBeNull();
  });
  it("freezes and resets the counter on the Nth failure", () => {
    const r = lockoutAfterFailure(MAX_LOGIN_ATTEMPTS - 1, now);
    expect(r.failedLoginAttempts).toBe(0);
    expect(r.lockedUntil).toEqual(new Date(now + LOCKOUT_MINUTES * 60_000));
  });
  it("treats a negative/garbage prior count as zero", () => {
    expect(lockoutAfterFailure(-5, now).failedLoginAttempts).toBe(1);
  });
});
