/**
 * Per-org print preferences (organizations.print_settings jsonb) + the registry of
 * printable documents and their columns.
 *
 * The registry mirrors — by Arabic label — the hardcoded `columns` array of each
 * document print route under app/(print)/erp. Hiding works by label match inside
 * DocumentSheet, so a registry label that drifts from the route simply stops
 * hiding (fails open, never breaks the printout).
 */

export type PrintSettings = {
  header?: {
    /** Printed instead of nameAr on documents only. */
    displayName?: string;
    /** false = no logo and no initials tile. */
    showLogo?: boolean;
    showAddress?: boolean;
    showPhone?: boolean;
    showTaxNumber?: boolean;
    /** Extra line above the document footer (thanks / terms). */
    footerText?: string;
  };
  /** docKey → hidden column labels. */
  docs?: Record<string, string[]>;
};

export type PrintDocDef = {
  key: string;
  label: string;
  /** Column labels exactly as the print route declares them. */
  columns: { label: string; locked?: boolean }[];
};

const item = { label: "الصنف", locked: true } as const;

export const PRINT_DOC_REGISTRY: PrintDocDef[] = [
  { key: "sales-order", label: "أمر بيع", columns: [{ label: "#" }, item, { label: "الكمية" }, { label: "المُسلَّم" }, { label: "السعر" }, { label: "الخصم" }, { label: "الإجمالي" }] },
  { key: "sales-invoice", label: "فاتورة بيع", columns: [{ label: "#" }, item, { label: "الكمية" }, { label: "السعر" }, { label: "الخصم" }, { label: "الإجمالي" }] },
  { key: "sales-quotation", label: "عرض سعر", columns: [{ label: "#" }, item, { label: "الكمية" }, { label: "السعر" }, { label: "الخصم" }, { label: "الإجمالي" }] },
  { key: "sales-delivery", label: "إذن صرف", columns: [{ label: "#" }, item, { label: "الكمية" }] },
  { key: "sales-return", label: "مرتجع بيع", columns: [{ label: "#" }, item, { label: "الكمية" }, { label: "السعر" }, { label: "الإجمالي" }] },
  { key: "purchase-order", label: "أمر شراء", columns: [{ label: "#" }, item, { label: "الكمية" }, { label: "المستلم" }, { label: "السعر" }, { label: "الخصم" }, { label: "الإجمالي" }] },
  { key: "purchase-invoice", label: "فاتورة شراء", columns: [{ label: "#" }, item, { label: "الكمية" }, { label: "السعر" }, { label: "شحن/وحدة" }, { label: "الخصم" }, { label: "الإجمالي" }] },
  { key: "purchase-receipt", label: "إذن استلام", columns: [{ label: "#" }, item, { label: "التشغيلة / الصلاحية" }, { label: "المستلم" }, { label: "المرفوض" }] },
  { key: "purchase-return", label: "مرتجع شراء", columns: [{ label: "#" }, item, { label: "الكمية" }, { label: "السعر" }, { label: "الإجمالي" }] },
  { key: "purchase-requisition", label: "طلب شراء داخلي", columns: [{ label: "#" }, item, { label: "الكمية" }] },
  { key: "inventory-adjustment", label: "تسوية مخزون", columns: [item, { label: "المخزن" }, { label: "الكمية الفعلية" }, { label: "الفرق" }, { label: "التكلفة" }, { label: "القيمة" }] },
  { key: "inventory-transfer", label: "تحويل مخزني", columns: [item, { label: "الكمية" }] },
  { key: "journal", label: "قيد يومية", columns: [{ label: "الحساب", locked: true }, { label: "البيان" }, { label: "مدين", locked: true }, { label: "دائن", locked: true }] },
  { key: "payroll", label: "مسير رواتب", columns: [{ label: "الموظف", locked: true }, { label: "الأساسي" }, { label: "البدلات" }, { label: "الإجمالي" }, { label: "الاستقطاعات" }, { label: "الضريبة" }, { label: "الصافي", locked: true }] },
  { key: "expense-claim", label: "مطالبة مصروفات", columns: [{ label: "البند", locked: true }, { label: "البيان" }, { label: "المبلغ", locked: true }] },
  { key: "distribution", label: "توزيع أرباح", columns: [{ label: "المستثمر", locked: true }, { label: "نسبة الملكية" }, { label: "المبلغ", locked: true }] },
];

const LOCKED = new Map(PRINT_DOC_REGISTRY.map((d) => [d.key, new Set(d.columns.filter((c) => c.locked).map((c) => c.label))]));

/** Defaults + drop anything invalid (unknown doc keys pass through harmlessly; locked labels are stripped). */
export function resolvePrintSettings(raw: unknown): Required<Pick<PrintSettings, "header" | "docs">> {
  const s = (raw ?? {}) as PrintSettings;
  const h = s.header ?? {};
  const docs: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(s.docs ?? {})) {
    if (!Array.isArray(v)) continue;
    const locked = LOCKED.get(k);
    docs[k] = v.filter((l) => typeof l === "string" && !locked?.has(l));
  }
  return {
    header: {
      displayName: h.displayName?.trim() || undefined,
      showLogo: h.showLogo !== false,
      showAddress: h.showAddress !== false,
      showPhone: h.showPhone !== false,
      showTaxNumber: h.showTaxNumber !== false,
      footerText: h.footerText?.trim() || undefined,
    },
    docs,
  };
}
