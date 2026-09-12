import { describe, it, expect } from "vitest";
import { APPROVALS_OFF, parseApprovalPolicy, needsApproval, decisionBlocked, canSelfApprove, type ApprovalPolicy } from "../approval-policy";

const on: ApprovalPolicy = {
  enabled: true, purchaseOrder: 25_000, salesDiscountPct: 10, salesBelowCost: true, stockWriteOff: 5_000, payment: 20_000, expense: 3_000,
};

describe("parseApprovalPolicy", () => {
  it("anything missing or malformed is 'approvals off' — every existing company", () => {
    expect(parseApprovalPolicy(null)).toEqual(APPROVALS_OFF);
    expect(parseApprovalPolicy("x")).toEqual(APPROVALS_OFF);
    expect(parseApprovalPolicy({ enabled: "yes", purchaseOrder: -5 })).toEqual(APPROVALS_OFF);
  });

  it("keeps a carried-over PO threshold", () => {
    // The migration writes exactly this for a company that had po_approval_threshold set.
    expect(parseApprovalPolicy({ enabled: true, purchaseOrder: "25000.0000" })).toMatchObject({ enabled: true, purchaseOrder: 25_000 });
  });
});

describe("needsApproval", () => {
  it("never asks when the company hasn't turned approvals on", () => {
    expect(needsApproval({ ...on, enabled: false }, { docType: "PURCHASE_ORDER", total: 1_000_000 })).toBeNull();
  });

  it("amount thresholds: at the limit passes, above it asks, 0 means never", () => {
    expect(needsApproval(on, { docType: "PURCHASE_ORDER", total: 25_000 })).toBeNull();
    expect(needsApproval(on, { docType: "PURCHASE_ORDER", total: 25_001 })).toMatch(/قيمة أمر الشراء/);
    expect(needsApproval(on, { docType: "PAYMENT", amount: 20_500 })).toMatch(/قيمة الدفعة/);
    expect(needsApproval(on, { docType: "EXPENSE_CLAIM", amount: 3_100 })).toMatch(/قيمة المصروف/);
    expect(needsApproval(on, { docType: "STOCK_ADJUSTMENT", writeOff: 6_000 })).toMatch(/البضاعة الخارجة/);
    expect(needsApproval({ ...on, payment: 0 }, { docType: "PAYMENT", amount: 9_999_999 })).toBeNull();
  });

  it("the reason changes with the amount — so an approval covers only what was approved", () => {
    const a = needsApproval(on, { docType: "PURCHASE_ORDER", total: 30_000 });
    const b = needsApproval(on, { docType: "PURCHASE_ORDER", total: 32_000 });
    expect(a).not.toBeNull();
    expect(a).not.toEqual(b);
  });

  it("sales: a discount over the percentage asks", () => {
    const lines = [{ label: "سماعة", unitPrice: 100, unitCost: 60 }];
    expect(needsApproval(on, { docType: "SALES_ORDER", gross: 1000, discount: 100, lines })).toBeNull(); // exactly 10%
    expect(needsApproval(on, { docType: "SALES_ORDER", gross: 1000, discount: 150, lines })).toMatch(/خصم 15٪/);
  });

  it("sales: a line under its cost asks; an unknown cost is not judged", () => {
    expect(needsApproval(on, { docType: "SALES_ORDER", gross: 50, discount: 0, lines: [{ label: "كابل", unitPrice: 50, unitCost: 70 }] }))
      .toMatch(/أقل من التكلفة \(كابل\)/);
    expect(needsApproval(on, { docType: "SALES_ORDER", gross: 50, discount: 0, lines: [{ label: "خدمة", unitPrice: 50, unitCost: null }] })).toBeNull();
  });

  it("sales: both reasons are reported together", () => {
    const r = needsApproval(on, { docType: "SALES_ORDER", gross: 100, discount: 50, lines: [{ label: "كابل", unitPrice: 50, unitCost: 70 }] });
    expect(r).toMatch(/خصم/);
    expect(r).toMatch(/أقل من التكلفة/);
  });
});

describe("separation of duties", () => {
  it("nobody without the permission decides", () => {
    expect(decisionBlocked({ requestedBy: "u1", deciderId: "u2", deciderRole: "admin", deciderCanDecide: false })).not.toBeNull();
  });

  it("the requester can't approve their own request…", () => {
    expect(decisionBlocked({ requestedBy: "u1", deciderId: "u1", deciderRole: "accountant", deciderCanDecide: true })).toMatch(/مدير تاني/);
  });

  it("…unless they are the admin (owner), so a one-person company isn't stuck", () => {
    expect(decisionBlocked({ requestedBy: "u1", deciderId: "u1", deciderRole: "admin", deciderCanDecide: true })).toBeNull();
    expect(canSelfApprove("admin", true)).toBe(true);
    expect(canSelfApprove("accountant", true)).toBe(false);
    expect(canSelfApprove("admin", false)).toBe(false);
  });

  it("someone else with the permission decides freely", () => {
    expect(decisionBlocked({ requestedBy: "u1", deciderId: "u2", deciderRole: "accountant", deciderCanDecide: true })).toBeNull();
  });
});
