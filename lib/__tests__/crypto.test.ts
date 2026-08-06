import { describe, it, expect, beforeAll } from "vitest";

// AUTH_SECRET must exist before importing crypto (module reads it lazily per call, but
// keep it deterministic for the suite).
beforeAll(() => { process.env.AUTH_SECRET = "test-auth-secret-32-chars-long!!"; delete process.env.ENCRYPTION_KEY; });

import { encryptSecret, decryptSecret, secretEquals } from "../crypto";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a secret and emits the versioned envelope", () => {
    const ct = encryptSecret("hello-token");
    expect(ct.startsWith("v1:")).toBe(true);
    expect(ct.split(":")).toHaveLength(4);
    expect(decryptSecret(ct)).toBe("hello-token");
  });

  it("decrypts the LEGACY 3-part format (backward compatibility)", () => {
    // A legacy value is the versioned one with the "v1:" prefix stripped; it must still
    // decode under the AUTH_SECRET-derived key so existing stored tokens keep working.
    const legacy = encryptSecret("legacy-token").slice(3);
    expect(legacy.split(":")).toHaveLength(3);
    expect(decryptSecret(legacy)).toBe("legacy-token");
  });

  it("returns null on tampered ciphertext", () => {
    const ct = encryptSecret("x");
    expect(decryptSecret(ct.slice(0, -4) + "AAAA")).toBeNull();
    expect(decryptSecret("garbage")).toBeNull();
  });
});

describe("secretEquals — constant-time compare", () => {
  it("matches equal strings, rejects unequal / empty", () => {
    expect(secretEquals("abc", "abc")).toBe(true);
    expect(secretEquals("abc", "abd")).toBe(false);
    expect(secretEquals("abc", "abcd")).toBe(false);
    expect(secretEquals("", "")).toBe(false);
    expect(secretEquals(null, "abc")).toBe(false);
    expect(secretEquals(undefined, undefined)).toBe(false);
  });
});
