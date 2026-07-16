import { describe, it, expect } from "vitest";
import { planAssetAcquisition } from "../asset-acquisition";

const OK = { acquisition: "CAPITALIZE" as const, cost: 100_000, glAssetAccountId: "A", fundingAccountId: "F", canPost: true };

describe("planAssetAcquisition", () => {
  it("EXISTING posts nothing — the asset is already in the GL", () => {
    // Migrated opening balance, or bought on a purchase invoice that already
    // posted. Posting again would double-count the asset and the money both.
    expect(planAssetAcquisition({ ...OK, acquisition: "EXISTING" })).toEqual({ post: false });
  });

  it("EXISTING posts nothing even with every account filled in", () => {
    // The mode decides, not the presence of accounts — the accounts are still
    // needed for depreciation.
    expect(planAssetAcquisition({ ...OK, acquisition: "EXISTING", canPost: true })).toEqual({ post: false });
  });

  it("CAPITALIZE returns the entry inputs", () => {
    expect(planAssetAcquisition(OK)).toEqual({
      post: true, assetAccountId: "A", fundingAccountId: "F", cost: 100_000,
    });
  });

  // Each of these refuses rather than quietly falling back to register-only. An
  // asset the user believes was capitalized but silently wasn't shows up months
  // later as a balance sheet that doesn't foot.
  it("refuses to capitalize without post permission", () => {
    expect(planAssetAcquisition({ ...OK, canPost: false })).toEqual({ error: expect.stringContaining("صلاحية") });
  });

  it("refuses to capitalize with no asset account", () => {
    expect(planAssetAcquisition({ ...OK, glAssetAccountId: undefined })).toEqual({ error: expect.stringContaining("حساب الأصل") });
    expect(planAssetAcquisition({ ...OK, glAssetAccountId: "" })).toEqual({ error: expect.stringContaining("حساب الأصل") });
  });

  it("refuses to capitalize with no funding account — the credit side has to go somewhere", () => {
    expect(planAssetAcquisition({ ...OK, fundingAccountId: undefined })).toEqual({ error: expect.stringContaining("حساب السداد") });
  });

  it("refuses a zero-cost capitalization", () => {
    // postEntry rejects a zero-debit line, so this cannot be expressed as an entry.
    expect(planAssetAcquisition({ ...OK, cost: 0 })).toEqual({ error: expect.stringContaining("صفر") });
  });

  it("never silently downgrades to register-only", () => {
    // The property that matters: a CAPITALIZE request either posts or errors. It
    // must never come back as { post: false }, which would register the asset while
    // leaving the user believing it was capitalized.
    const broken = [
      { ...OK, canPost: false },
      { ...OK, glAssetAccountId: undefined },
      { ...OK, fundingAccountId: undefined },
      { ...OK, cost: 0 },
      { ...OK, cost: -5 },
    ];
    for (const input of broken) {
      const r = planAssetAcquisition(input);
      expect(r).toHaveProperty("error");
      expect(r).not.toEqual({ post: false });
    }
  });
});
