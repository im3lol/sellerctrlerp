import { confirm } from "@/components/erp/confirm";

/**
 * The one warning shown before any permanent delete, in one place so the wording stays
 * identical everywhere. Deliberately discouraging: cancelling already zeroes a document's
 * effect, so deleting buys nothing but a shorter list and costs the paper trail. It exists
 * for documents created by mistake, not as part of anyone's daily workflow.
 */
export const confirmPurge = (label: string) =>
  confirm({
    danger: true,
    title: `حذف ${label} نهائياً؟`,
    description:
      `سيُمحى ${label} وقيوده وحركاته من السجلات نهائياً — لا يمكن التراجع.\n\n` +
      "الإلغاء وحده يكفي في الأغلب: أثر المستند صفر بالفعل، ويبقى محفوظاً للمراجعة. " +
      "استخدم الحذف فقط لمستند أُنشئ بالخطأ ولا تريد أثراً له.",
    confirmText: "نعم، احذف نهائياً",
    cancelText: "رجوع",
  });
