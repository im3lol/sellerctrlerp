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
  // Stock receipt — the refusals the simple decision screen actually hits.
  "An Amazon receipt requires FBA source evidence": "أمازون لم يسجّل استلام هذا المنتج في مخزن FBA (لا يوجد له سطر في تقرير مرتجعات أمازون). لو المنتج وصل عندك اختر «وصل إلى مخزني»، ولو لسه ما وصلش اختر «لم يصل بعد» حتى يظهر في تقرير أمازون.",
  "Historical or invalid receipt evidence is observation-only": "سجل أمازون لهذا المرتجع أقدم من تاريخ بدء العمل بالمرتجعات، فلا يُستخدم لإدخال مخزون تلقائيًا. لو الرصيد مختلف صحّحه من «مطابقة FBA»، أو اختر «وصل إلى مخزني» لو المنتج عندك.",
  "Amazon source does not confirm sellable condition; quarantine the goods for review": "أمازون لم يسجّل المنتج كصالح للبيع؛ اختر «وصل تالف» أو استلمه في مخزن الفحص.",
  "Amazon receipt must use this account's FBA warehouse": "استلام أمازون لازم يكون على مخزن FBA الخاص بهذا الحساب.",
  "A seller-fulfilled return does not prove receipt at Amazon": "هذا مرتجع شحن ذاتي (ليس FBA)؛ اختر «وصل إلى مخزني».",
  "Receipt evidence SKU does not match the original item": "كود المنتج في تقرير أمازون لا يطابق صنف الفاتورة الأصلية.",
  "Receipt quantity exceeds the remaining source evidence": "الكمية أكبر من الكمية التي سجّلها أمازون كمرتجعة.",
  "Return report and ledger describe the same goods; receipt evidence cannot be counted twice": "تقرير المرتجعات وسجل المخزون يصفان نفس القطع؛ لا يمكن احتسابها مرتين.",
  "Only a customer-return ledger event proves this return receipt": "حركة سجل أمازون المختارة ليست مرتجع عميل.",
  "The return ledger reference does not match the original order": "حركة سجل أمازون تخص طلبًا آخر.",
  "Receipt exceeds the unresolved return quantity": "الكمية أكبر من المتبقي من المرتجع.",
  "The original issue quantity has already been returned": "الكمية دي اترجعت بالفعل على إذن الصرف الأصلي.",
  "Historical receipts require a separately approved reconciliation": "تاريخ الاستلام أقدم من بدء العمل بالمرتجعات؛ يحتاج تسوية منفصلة.",
  "Unsellable goods require a separate designated quarantine warehouse": "البضاعة غير الصالحة تحتاج مخزن فحص منفصل؛ حدّده من إعدادات المخازن.",
  "Expired returns require quarantine or approved disposal": "المنتج منتهي الصلاحية؛ استلمه في مخزن الفحص أو كتالف.",
  "Serial-tracked returns require a serial allocation review before posting": "الصنف بأرقام تسلسلية؛ يحتاج تحديد الرقم التسلسلي قبل الاستلام.",
  "A partial return from several original lots requires a separate lot-cost allocation review": "المنتج خرج من أكثر من دفعة؛ الإرجاع الجزئي يحتاج مراجعة توزيع التكلفة.",
  "Separate the original expiry lots before returning them": "المنتج خرج من دفعات بتواريخ صلاحية مختلفة؛ افصلها قبل الإرجاع.",
  "Missing goods cannot be restocked": "منتج لم يصل لا يمكن إدخاله للمخزن.",
  "Invalid company warehouse": "المخزن المختار غير موجود أو غير نشط.",
  "A local receipt cannot enter a marketplace warehouse": "«وصل إلى مخزني» لازم يكون على مخزن من مخازنك، مش مخزن أمازون أو نون. لو المنتج رجع لأمازون اختر «رجع إلى مخزن أمازون».",
  "Match the original sales line first": "اختر الفاتورة الأصلية لهذا المنتج أولًا.",
  "The stock issue does not belong to the original sale": "حركة الصرف لا تخص البيع الأصلي.",
  "Original invoice is no longer posted": "الفاتورة الأصلية لم تعد مرحّلة.",
  "Original delivery is no longer posted": "إذن الصرف الأصلي لم يعد مؤكّدًا.",
  "Missing inventory/return accounts": "حسابات المخزون/المرتجعات (1104، 5101، 5301) غير موجودة في دليل الحسابات.",
  // Reimbursement
  "An open claim allocation is required": "لا توجد مطالبة تعويض مفتوحة لهذا المنتج.",
  "An Amazon reimbursement source is required": "لا يوجد تعويض من أمازون بهذا الرقم.",
  "Claim/source currency mismatch": "عملة التعويض لا تطابق عملة المطالبة.",
  "A posted reimbursement wallet movement is required": "إيداع التعويض لم يظهر بعد في تسويات أمازون.",
  "The source or wallet amount is already allocated": "مبلغ التعويض مربوط بالفعل بمطالبة أخرى.",
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
