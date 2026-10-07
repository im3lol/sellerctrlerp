// Pure, framework-free transactional email templates (inline styles so they render in
// any mail client), in the recipient's language: Arabic RTL by default, English LTR when
// the caller passes "en". Each returns { subject, html, text }. No server deps →
// unit-testable. Callers pass the app URL + data; nothing is read from env here.
import { dirOf, fill, translator, type Locale } from "@/lib/i18n";

const BRAND = "#0A33D1";
const egp = (n: number, locale: Locale) =>
  locale === "en" ? `${n.toLocaleString("en-US")} EGP` : `${n.toLocaleString("ar-EG-u-nu-latn")} ج.م`;
const longDate = (d: Date, locale: Locale) =>
  d.toLocaleDateString(locale === "en" ? "en-GB" : "ar-EG-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });

export type Email = { subject: string; html: string; text: string };

/** Shared branded shell. `cta` is an optional {label, href} button. */
function layout(opts: { heading: string; bodyHtml: string; cta?: { label: string; href: string } }, locale: Locale): string {
  const t = translator(locale);
  const dir = dirOf(locale);
  const align = dir === "rtl" ? "right" : "left";
  const btn = opts.cta
    ? `<tr><td style="padding:8px 0 4px"><a href="${opts.cta.href}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:10px">${opts.cta.label}</a></td></tr>`
    : "";
  return `<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f7fc;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#0e1726">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fc;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #dde4f0;border-radius:16px;overflow:hidden">
        <tr><td style="background:${BRAND};padding:20px 28px"><span style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-.5px">seller<span style="color:#ffd54a">ctrl</span></span></td></tr>
        <tr><td style="padding:28px" dir="${dir}" align="${align}">
          <h1 style="margin:0 0 14px;font-size:20px;font-weight:800;color:#0e1726">${opts.heading}</h1>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.8;color:#3a4658">
            ${opts.bodyHtml}
            ${btn}
          </table>
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #eef2fb;font-size:12px;color:#8a94a6" dir="${dir}" align="${align}">
          SellerCtrl — ${t("نظام ERP لبائعي أمازون · للدعم:")} <a href="mailto:info@sellerctrl.com" style="color:${BRAND}">info@sellerctrl.com</a> · ${t("واتساب")} <span dir="ltr">+201025246324</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const row = (html: string) => `<tr><td style="padding:4px 0">${html}</td></tr>`;

/** Escape anything the tenant typed (company name, plan name, their own name) before it
 *  goes into the HTML body — otherwise a company called `<a href="http://evil">…` mails
 *  its own members a link dressed as an official SellerCtrl notice. */
const esc = (v: string) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A notice about one approval request — to the approvers when it is filed, to the
 *  requester when it is decided. Every line is tenant text, so all of it is escaped. */
export function approvalEmail(d: { heading: string; lines: string[]; href: string }, locale: Locale = "ar"): Email {
  const t = translator(locale);
  return {
    subject: d.heading,
    html: layout({ heading: esc(d.heading), bodyHtml: d.lines.map((l) => row(esc(l))).join(""), cta: { label: t("افتح المستند"), href: d.href } }, locale),
    text: `${d.heading}\n${d.lines.join("\n")}\n${d.href}`,
  };
}

export function welcomeEmail(d: { name?: string; orgName: string; appUrl: string }, locale: Locale = "ar"): Email {
  const t = translator(locale);
  const hi = d.name ? fill(t("أهلاً {0}"), [d.name]) : t("أهلاً بك");
  const hiHtml = d.name ? fill(t("أهلاً {0}"), [esc(d.name)]) : t("أهلاً بك");
  return {
    subject: t("أهلاً بك في SellerCtrl 🎉"),
    html: layout({
      heading: `${hiHtml} 👋`,
      bodyHtml:
        row(fill(t("تم إنشاء حساب مؤسسة «{0}» بنجاح. دلوقتي تقدر تدير محاسبتك ومخزونك ومبيعاتك وتربط حساب أمازون — كله من مكان واحد."), [`<b>${esc(d.orgName)}</b>`])) +
        row(t("ابدأ بإكمال إعداد حسابك (الأصناف، المخازن، ربط أمازون) من لوحة التحكم.")),
      cta: { label: t("افتح لوحة التحكم"), href: `${d.appUrl}/dashboard` },
    }, locale),
    text: fill(t("{0}! تم إنشاء حساب مؤسسة «{1}» في SellerCtrl. افتح لوحتك: {2}"), [hi, d.orgName, `${d.appUrl}/dashboard`]),
  };
}

export function receiptEmail(d: { orgName: string; planName: string; interval: string; amount: number; expiresAt: Date; appUrl: string }, locale: Locale = "ar"): Email {
  const t = translator(locale);
  const until = longDate(d.expiresAt, locale);
  const interval = t(d.interval === "ANNUAL" ? "سنوي" : "شهري");
  const amount = egp(d.amount, locale);
  return {
    subject: fill(t("إيصال دفع اشتراك SellerCtrl — باقة {0}"), [d.planName]),
    html: layout({
      heading: t("تم استلام دفعتك ✅"),
      bodyHtml:
        row(fill(t("شكرًا لك — تم تفعيل اشتراك مؤسسة «{0}»."), [`<b>${esc(d.orgName)}</b>`])) +
        row(`<b>${t("الباقة:")}</b> ${esc(d.planName)} (${interval})`) +
        row(`<b>${t("المبلغ:")}</b> ${amount}`) +
        row(`<b>${t("سارٍ حتى:")}</b> ${until}`),
      cta: { label: t("إدارة الاشتراك"), href: `${d.appUrl}/settings/subscription` },
    }, locale),
    text: fill(t("تم تفعيل اشتراك «{0}» — باقة {1} ({2})، المبلغ {3}، سارٍ حتى {4}."), [d.orgName, d.planName, interval, amount, until]),
  };
}

export function expiryReminderEmail(d: { orgName: string; planName: string; daysLeft: number; expiresAt: Date; appUrl: string }, locale: Locale = "ar"): Email {
  const t = translator(locale);
  const until = longDate(d.expiresAt, locale);
  const when = d.daysLeft <= 0 ? t("اليوم") : fill(t("خلال {0} يوم"), [d.daysLeft]);
  return {
    subject: fill(t("تذكير: اشتراكك في SellerCtrl ينتهي {0}"), [when]),
    html: layout({
      heading: t("تذكير بتجديد الاشتراك ⏰"),
      bodyHtml:
        row(fill(t("اشتراك مؤسسة «{0}» (باقة {1}) ينتهي {2}."), [`<b>${esc(d.orgName)}</b>`, esc(d.planName), `<b>${until}</b>`])) +
        row(t("جدّد الآن لتفادي انقطاع الوصول إلى بياناتك ومزامنة أمازون.")),
      cta: { label: t("جدّد الاشتراك"), href: `${d.appUrl}/settings/subscription` },
    }, locale),
    text: fill(t("اشتراك «{0}» (باقة {1}) ينتهي {2}. جدّد الآن: {3}"), [d.orgName, d.planName, until, `${d.appUrl}/settings/subscription`]),
  };
}
