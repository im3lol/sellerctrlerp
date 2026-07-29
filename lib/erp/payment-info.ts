/** Offline payment options shown on the subscription page (Paymob/Visa comes later). */
export const WALLET_NUMBER = "01025246324";

/** Support line for the post-transfer subscription handoff (wa.me — intl, no +). */
export const SUPPORT_WHATSAPP = "201025246324";

// XPAY = paid online through the xpay gateway (auto-activates on verified payment).
// The rest are manual transfers verified by support over WhatsApp.
export const PAYMENT_METHODS = [
  { key: "XPAY", label: "بطاقة / محفظة (دفع فوري)", detail: "ادفع أونلاين بالبطاقة أو المحفظة الإلكترونية أو فوري — يُفعَّل اشتراكك فور نجاح الدفع.", enabled: true },
  { key: "INSTAPAY", label: "إنستا باي", detail: `حوّل قيمة الباقة على الرقم ${WALLET_NUMBER} عبر إنستا باي ثم أدخل رقم العملية.`, enabled: true },
  { key: "VODAFONE", label: "فودافون كاش", detail: `حوّل قيمة الباقة على الرقم ${WALLET_NUMBER} عبر فودافون كاش ثم أدخل رقم العملية.`, enabled: true },
  { key: "BANK", label: "تحويل بنكي", detail: "حوّل قيمة الباقة عبر حوالة بنكية ثم أدخل رقم/مرجع الحوالة.", enabled: true },
] as const;

export type PaymentMethodKey = (typeof PAYMENT_METHODS)[number]["key"];
