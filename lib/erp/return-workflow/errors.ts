/** The returns engine throws English messages; the UI is Arabic only. One place turns
 * them into what the trader reads. Arabic messages pass through untouched. */
const exact: Record<string, string> = {
  "Select the original lines whose expected quantity changed": "اختر سطور الفاتورة الأصلية التي تغيّرت كميتها المتوقعة",
  "Expected quantity must reference an already matched line": "الكمية المتوقعة لازم تكون لسطر مربوط بالفعل",
  "Expected quantity cannot erase receipts or exceed the original sale": "الكمية المتوقعة لا يمكن أن تقل عن المستلم أو تزيد عن الكمية المباعة",
  "The loss must belong to this account's FBA warehouse": "الخسارة لازم تكون في مخزن FBA الخاص بهذا الحساب",
  "An existing posted stock loss and journal are required": "لازم تكون الخسارة مُرحّلة بتسوية مخزون وقيد محاسبي",
  "Invalid same-account evidence allocation": "مصادر الإثبات المختارة غير صالحة لهذا الحساب",
  "An active allocation cannot be replaced; reopen and reverse it first": "لا يمكن استبدال ربط فعّال؛ أعد فتح المرتجع واعكس القرار أولًا",
  "The selected invoice lines do not belong to this order/account": "سطور الفاتورة المختارة لا تخص هذا الطلب أو الحساب",
  "Expected return quantity exceeds the original sale": "كمية المرتجع المتوقعة أكبر من الكمية المباعة",
  "A financial refund source exists; reconcile it instead of exempting it": "يوجد استرداد مالي لهذا المرتجع؛ سوِّه بدل إعفائه",
  "Invalid waived quantity": "كمية التنازل غير صالحة",
  "Claim line does not belong to this case": "سطر المطالبة لا يخص هذا المرتجع",
  "Closing a claim requires an explicit reason": "إقفال المطالبة يحتاج سبب واضح",
  "Claim not found": "المطالبة غير موجودة",
  "This operation needs its dedicated document preview before it can be approved": "هذا الإجراء يحتاج معاينة المستند الخاص به قبل الاعتماد",
  "Return case not found": "المرتجع غير موجود",
  "Return workflow is in observation mode; posting is disabled": "المرتجعات في وضع المراقبة؛ تنفيذ القرارات متوقف",
};

export function arabicReturnError(message: string): string {
  if (/[؀-ۿ]/.test(message)) return message;
  if (exact[message]) return exact[message];
  if (/changed|reused/i.test(message)) return "بيانات المرتجع اتحدثت؛ حدّث الصفحة ثم راجع القرار";
  if (/exception|revised/i.test(message)) return "وصلت معلومات جديدة من أمازون؛ راجعها قبل تأكيد حالة المرتجع";
  if (/Historical|current.*source|observation-only/i.test(message)) return "هذا المصدر قديم ويحتاج مراجعة قبل تسجيل أثر جديد؛ لم تتغير الأرصدة";
  if (/allocated|already|exceeds|twice|remaining/i.test(message)) return "الكمية أو التعويض مسجّلان بالفعل أو يتجاوزان المتبقي؛ لم يُكرر التسجيل";
  return "القرار يحتاج مراجعة أصل الحركة أو التكلفة؛ لم تتغير الأرصدة";
}
