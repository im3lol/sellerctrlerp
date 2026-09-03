// Pure, framework-free transactional email templates (Arabic RTL, inline styles so
// they render in any mail client). Each returns { subject, html, text }. No server
// deps → unit-testable. Callers pass the app URL + data; nothing is read from env here.

const BRAND = "#0A33D1";
const egp = (n: number) => `${n.toLocaleString("ar-EG-u-nu-latn")} ج.م`;
const intervalLabel = (i: string) => (i === "ANNUAL" ? "سنوي" : "شهري");

export type Email = { subject: string; html: string; text: string };

/** Shared branded shell. `cta` is an optional {label, href} button. */
function layout(opts: { heading: string; bodyHtml: string; cta?: { label: string; href: string } }): string {
  const btn = opts.cta
    ? `<tr><td style="padding:8px 0 4px"><a href="${opts.cta.href}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:10px">${opts.cta.label}</a></td></tr>`
    : "";
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f7fc;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#0e1726">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fc;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #dde4f0;border-radius:16px;overflow:hidden">
        <tr><td style="background:${BRAND};padding:20px 28px"><span style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-.5px">seller<span style="color:#ffd54a">ctrl</span></span></td></tr>
        <tr><td style="padding:28px" dir="rtl" align="right">
          <h1 style="margin:0 0 14px;font-size:20px;font-weight:800;color:#0e1726">${opts.heading}</h1>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.8;color:#3a4658">
            ${opts.bodyHtml}
            ${btn}
          </table>
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #eef2fb;font-size:12px;color:#8a94a6" dir="rtl" align="right">
          SellerCtrl — نظام ERP لبائعي أمازون · للدعم: <a href="mailto:info@sellerctrl.com" style="color:${BRAND}">info@sellerctrl.com</a> · واتساب <span dir="ltr">+201025246324</span>
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

export function welcomeEmail(d: { name?: string; orgName: string; appUrl: string }): Email {
  const hi = d.name ? `أهلاً ${d.name}` : "أهلاً بك";
  const hiHtml = d.name ? `أهلاً ${esc(d.name)}` : "أهلاً بك";
  return {
    subject: "أهلاً بك في SellerCtrl 🎉",
    html: layout({
      heading: `${hiHtml} 👋`,
      bodyHtml:
        row(`تم إنشاء حساب مؤسسة «<b>${esc(d.orgName)}</b>» بنجاح. دلوقتي تقدر تدير محاسبتك ومخزونك ومبيعاتك وتربط حساب أمازون — كله من مكان واحد.`) +
        row(`ابدأ بإكمال إعداد حسابك (الأصناف، المخازن، ربط أمازون) من لوحة التحكم.`),
      cta: { label: "افتح لوحة التحكم", href: `${d.appUrl}/dashboard` },
    }),
    text: `${hi}! تم إنشاء حساب مؤسسة «${d.orgName}» في SellerCtrl. افتح لوحتك: ${d.appUrl}/dashboard`,
  };
}

export function receiptEmail(d: { orgName: string; planName: string; interval: string; amount: number; expiresAt: Date; appUrl: string }): Email {
  const until = d.expiresAt.toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });
  return {
    subject: `إيصال دفع اشتراك SellerCtrl — باقة ${d.planName}`,
    html: layout({
      heading: "تم استلام دفعتك ✅",
      bodyHtml:
        row(`شكرًا لك — تم تفعيل اشتراك مؤسسة «<b>${esc(d.orgName)}</b>».`) +
        row(`<b>الباقة:</b> ${esc(d.planName)} (${intervalLabel(d.interval)})`) +
        row(`<b>المبلغ:</b> ${egp(d.amount)}`) +
        row(`<b>سارٍ حتى:</b> ${until}`),
      cta: { label: "إدارة الاشتراك", href: `${d.appUrl}/settings/subscription` },
    }),
    text: `تم تفعيل اشتراك «${d.orgName}» — باقة ${d.planName} (${intervalLabel(d.interval)})، المبلغ ${egp(d.amount)}، سارٍ حتى ${until}.`,
  };
}

export function expiryReminderEmail(d: { orgName: string; planName: string; daysLeft: number; expiresAt: Date; appUrl: string }): Email {
  const until = d.expiresAt.toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });
  const when = d.daysLeft <= 0 ? "اليوم" : `خلال ${d.daysLeft.toLocaleString("ar-EG-u-nu-latn")} يوم`;
  return {
    subject: `تذكير: اشتراكك في SellerCtrl ينتهي ${when}`,
    html: layout({
      heading: "تذكير بتجديد الاشتراك ⏰",
      bodyHtml:
        row(`اشتراك مؤسسة «<b>${esc(d.orgName)}</b>» (باقة ${esc(d.planName)}) ينتهي <b>${until}</b>.`) +
        row(`جدّد الآن لتفادي انقطاع الوصول إلى بياناتك ومزامنة أمازون.`),
      cta: { label: "جدّد الاشتراك", href: `${d.appUrl}/settings/subscription` },
    }),
    text: `اشتراك «${d.orgName}» (باقة ${d.planName}) ينتهي ${until}. جدّد الآن: ${d.appUrl}/settings/subscription`,
  };
}
