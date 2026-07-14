/** Offline payment options shown on the subscription page (Paymob/Visa comes later). */
export const WALLET_NUMBER = "01025246324";

/** Support line for the post-transfer subscription handoff (wa.me — intl, no +). */
export const SUPPORT_WHATSAPP = "201025246324";

export const PAYMENT_METHODS = [
  { key: "INSTAPAY", label: "محفظة إلكترونية / إنستا باي", detail: `حوّل قيمة الباقة على الرقم ${WALLET_NUMBER} (إنستا باي أو المحفظة الإلكترونية) ثم أدخل رقم العملية.`, enabled: true },
  { key: "BANK", label: "تحويل بنكي", detail: "حوّل قيمة الباقة عبر حوالة بنكية ثم أدخل رقم/مرجع الحوالة.", enabled: true },
  { key: "VISA", label: "بطاقة فيزا (قريباً)", detail: "الدفع الإلكتروني بالفيزا عبر باي موب — قيد التفعيل قريباً.", enabled: false },
] as const;

export type PaymentMethodKey = (typeof PAYMENT_METHODS)[number]["key"];
