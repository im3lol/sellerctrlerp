/**
 * Single source of truth for document-number prefixes. Every document's number
 * is `PREFIX-YYYY-NNNN` (see nextDocumentNumber). The `key` here is BOTH the
 * stable identity a call site passes AND the default printed prefix — an org
 * can override the printed prefix per type without the call sites changing.
 *
 * SaaS invariant: with no override, the resolved prefix === key, so numbers are
 * byte-identical to before this registry existed. Do not reuse a key for two
 * different document types (that was the old PR bug: payroll and purchase
 * returns both drew "PR" — payroll is now "PY").
 */
export const DOC_TYPES = [
  { key: "JV", label: "قيد يومية" },
  { key: "DR", label: "قيد محاسبي مسودة" },
  { key: "SO", label: "أمر بيع" },
  { key: "PO", label: "أمر شراء" },
  { key: "QT", label: "عرض سعر" },
  { key: "SI", label: "فاتورة بيع" },
  { key: "PI", label: "فاتورة شراء" },
  { key: "DLV", label: "إذن صرف" },
  { key: "GRN", label: "إذن استلام" },
  { key: "RV", label: "سند قبض" },
  { key: "PV", label: "سند صرف" },
  { key: "SR", label: "مرتجع بيع" },
  { key: "PR", label: "مرتجع شراء" },
  { key: "TR", label: "تحويل مخزون" },
  { key: "AJ", label: "تسوية مخزون" },
  { key: "SM", label: "حركة مخزون" },
  { key: "MR", label: "طلب مواد" },
  { key: "EX", label: "مصروف" },
  { key: "EC", label: "مطالبة مصروفات" },
  { key: "ASM", label: "أمر تجميع" },
  { key: "PY", label: "مسيّر رواتب" },
  { key: "LV", label: "طلب إجازة" },
  { key: "PD", label: "توزيع أرباح" },
  { key: "LCV", label: "تكاليف استيراد" },
] as const;

export type DocTypeKey = (typeof DOC_TYPES)[number]["key"];

export const DOC_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  DOC_TYPES.map((d) => [d.key, d.label]),
);

/** A printed prefix must be 1–6 uppercase Latin letters (matches the `[A-Za-z]+-[0-9]{4}-[0-9]+` number regex). */
export const isValidPrefix = (p: string) => /^[A-Z]{1,6}$/.test(p);
