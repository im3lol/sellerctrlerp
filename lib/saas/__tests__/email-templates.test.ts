import { describe, it, expect } from "vitest";
import { welcomeEmail, receiptEmail, expiryReminderEmail } from "../email-templates";

const APP = "https://app.sellerctrl.com";

describe("email templates", () => {
  it("welcome: greets by name, names the org, links to the dashboard", () => {
    const m = welcomeEmail({ name: "أحمد", orgName: "متجر النور", appUrl: APP });
    expect(m.subject).toContain("أهلاً");
    expect(m.html).toContain("أحمد");
    expect(m.html).toContain("متجر النور");
    expect(m.html).toContain(`${APP}/dashboard`);
    expect(m.text).toContain("متجر النور");
  });

  it("welcome: no name → generic greeting, no 'undefined'", () => {
    const m = welcomeEmail({ orgName: "متجر", appUrl: APP });
    expect(m.html).not.toContain("undefined");
  });

  it("receipt: shows plan, interval, amount and expiry + support contact", () => {
    const m = receiptEmail({ orgName: "متجر النور", planName: "البائع", interval: "ANNUAL", amount: 15350, expiresAt: new Date("2027-07-29"), appUrl: APP });
    expect(m.subject).toContain("البائع");
    expect(m.html).toContain("سنوي");
    expect(m.html).toContain("ج.م"); // amount is formatted with the EGP suffix
    expect(m.html).toMatch(/15.?350/); // 15,350 with a locale thousands separator
    expect(m.html).toContain(`${APP}/settings/subscription`);
    expect(m.html).toContain("info@sellerctrl.com");
  });

  it("receipt: monthly interval label", () => {
    const m = receiptEmail({ orgName: "x", planName: "الأساسية", interval: "MONTHLY", amount: 999, expiresAt: new Date("2026-09-01"), appUrl: APP });
    expect(m.html).toContain("شهري");
  });

  it("expiry reminder: subject reflects days left + links to renew", () => {
    const m = expiryReminderEmail({ orgName: "متجر النور", planName: "البائع", daysLeft: 3, expiresAt: new Date("2026-08-01"), appUrl: APP });
    expect(m.subject).toContain("خلال");
    expect(m.html).toContain("متجر النور");
    expect(m.html).toContain(`${APP}/settings/subscription`);
    expect(m.text).toContain("جدّد");
  });

  it("expiry reminder: 0 days → «اليوم»", () => {
    const m = expiryReminderEmail({ orgName: "x", planName: "y", daysLeft: 0, expiresAt: new Date("2026-08-01"), appUrl: APP });
    expect(m.subject).toContain("اليوم");
  });
});
