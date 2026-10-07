import { describe, it, expect } from "vitest";
import { welcomeEmail, receiptEmail, expiryReminderEmail, approvalEmail } from "../email-templates";

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

  describe("in English", () => {
    it("welcome: English subject and body, LTR", () => {
      const m = welcomeEmail({ name: "Sara", orgName: "Nour <b>Store</b>", appUrl: APP }, "en");
      expect(m.subject).toBe("Welcome to SellerCtrl 🎉");
      expect(m.html).toContain('<html lang="en" dir="ltr">');
      expect(m.html).toContain("Hello Sara");
      expect(m.html).toContain("Nour &lt;b&gt;Store&lt;/b&gt;"); // still escaped
      expect(m.html).not.toMatch(/[\u0600-\u06FF]/);
      expect(m.text).toContain(`${APP}/dashboard`);
    });

    it("receipt: EGP amount, English date and interval", () => {
      const m = receiptEmail({ orgName: "Nour", planName: "Seller", interval: "ANNUAL", amount: 9990, expiresAt: new Date("2026-09-01"), appUrl: APP }, "en");
      expect(m.subject).toBe("SellerCtrl subscription payment receipt — Seller plan");
      expect(m.html).toContain("9,990 EGP");
      expect(m.html).toContain("1 September 2026");
      expect(m.html).toContain("(Yearly)");
      expect(m.html).not.toMatch(/[\u0600-\u06FF]/);
    });

    it("expiry reminder: days left in English", () => {
      expect(expiryReminderEmail({ orgName: "x", planName: "y", daysLeft: 3, expiresAt: new Date("2026-08-01"), appUrl: APP }, "en").subject)
        .toBe("Reminder: your SellerCtrl subscription ends in 3 days");
      expect(expiryReminderEmail({ orgName: "x", planName: "y", daysLeft: 0, expiresAt: new Date("2026-08-01"), appUrl: APP }, "en").subject)
        .toBe("Reminder: your SellerCtrl subscription ends today");
    });

    it("approval: English button, the lines are passed as written", () => {
      const m = approvalEmail({ heading: "✋ Sales invoice SI-1 is waiting for your approval", lines: ["Requested by: Ali"], href: `${APP}/x` }, "en");
      expect(m.html).toContain("Open the document");
      expect(m.html).toContain('dir="ltr"');
    });
  });
});
