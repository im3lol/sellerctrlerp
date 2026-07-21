import { round2 } from "@/lib/erp/money";

/**
 * Opening-balance maths. Pure, so the thing that decides whether a company can get
 * onto the product at all is testable without a database.
 */

export type OpeningKind = "ACCOUNT" | "CUSTOMER" | "SUPPLIER" | "ITEM";

export type OpeningLine = {
  kind: OpeningKind;
  accountId?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  itemId?: string | null;
  warehouseId?: string | null;
  debit?: number;
  credit?: number;
  quantity?: number | null;
  unitCost?: number | null;
  // CUSTOMER/SUPPLIER: this line is one opening invoice — its own reference + due date.
  reference?: string | null;
  dueDate?: string | null; // ISO date
};

/** The equity account every opening line balances against (ERPNext "Temporary Opening"). */
export const OPENING_EQUITY_CODE = "3002";

/** What a line contributes to the ledger, once ITEM lines are valued. */
export type Weighed = { debit: number; credit: number };

/**
 * Debit/credit for one line. ITEM lines are stock arriving, so they are always a
 * debit of quantity × unitCost — an opening stock line cannot be a credit.
 */
export function weigh(l: OpeningLine): Weighed {
  if (l.kind === "ITEM") {
    return { debit: round2((l.quantity ?? 0) * (l.unitCost ?? 0)), credit: 0 };
  }
  return { debit: round2(l.debit ?? 0), credit: round2(l.credit ?? 0) };
}

export type OpeningTotals = {
  debit: number;
  credit: number;
  /**
   * What account 3002 must take to make the entry balance. Positive = 3002 is
   * credited (the normal case: assets brought in exceed liabilities, and the
   * difference is the owners' opening equity). Negative = debited.
   */
  balancing: number;
};

export function totals(lines: OpeningLine[]): OpeningTotals {
  let debit = 0, credit = 0;
  for (const l of lines) {
    const w = weigh(l);
    debit += w.debit;
    credit += w.credit;
  }
  debit = round2(debit);
  credit = round2(credit);
  return { debit, credit, balancing: round2(debit - credit) };
}

/**
 * Reject what cannot be posted, before anything is written.
 *
 * The opening entry is the one entry nobody can check against a prior document —
 * there is no invoice or receipt behind it — so it has to be right on entry or it
 * is wrong forever, quietly, in every report built on top of it.
 */
export function validateOpening(lines: OpeningLine[]): string | null {
  if (lines.length === 0) return "أضف بندًا واحدًا على الأقل";

  for (const l of lines) {
    const w = weigh(l);

    if (l.kind === "ACCOUNT") {
      if (!l.accountId) return "اختر الحساب لكل بند من نوع «حساب»";
      if (w.debit > 0 && w.credit > 0) return "لا يمكن أن يكون البند مدينًا ودائنًا في نفس الوقت";
      if (w.debit === 0 && w.credit === 0) return "أدخل مبلغًا مدينًا أو دائنًا لكل بند";
      if (w.debit < 0 || w.credit < 0) return "المبالغ يجب أن تكون موجبة — استخدم الجانب الآخر بدل السالب";
    }

    if (l.kind === "CUSTOMER" || l.kind === "SUPPLIER") {
      const who = l.kind === "CUSTOMER" ? l.customerId : l.supplierId;
      if (!who) return l.kind === "CUSTOMER" ? "اختر العميل لكل بند من نوع «عميل»" : "اختر المورّد لكل بند من نوع «مورّد»";
      // A customer opening balance is money owed TO us (debit); a supplier's is money
      // we owe (credit). The other side would be a prepayment, which is a different
      // account entirely and not something to smuggle in through this document.
      const amount = l.kind === "CUSTOMER" ? w.debit : w.credit;
      const wrongSide = l.kind === "CUSTOMER" ? w.credit : w.debit;
      if (wrongSide > 0) {
        return l.kind === "CUSTOMER"
          ? "رصيد العميل الافتتاحي يكون مدينًا (مستحق علينا تحصيله) — للدفعات المقدّمة استخدم بندًا من نوع «حساب»"
          : "رصيد المورّد الافتتاحي يكون دائنًا (مستحق علينا سداده) — للدفعات المقدّمة استخدم بندًا من نوع «حساب»";
      }
      if (!(amount > 0)) return "أدخل مبلغًا أكبر من صفر لكل بند";
    }

    if (l.kind === "ITEM") {
      if (!l.itemId) return "اختر الصنف لكل بند من نوع «صنف»";
      if (!l.warehouseId) return "اختر المخزن لكل بند من نوع «صنف»";
      if (!(Number(l.quantity) > 0)) return "الكمية يجب أن تكون أكبر من صفر";
      // Zero-cost opening stock would silently make every future sale of that item
      // look like 100% margin, and it is not recoverable once movements are posted
      // on top of it.
      if (!(Number(l.unitCost) > 0)) return "أدخل تكلفة الوحدة — تكلفة صفر تجعل ربح كل بيع لاحق خاطئًا";
    }
  }

  const t = totals(lines);
  if (t.debit === 0 && t.credit === 0) return "لا توجد مبالغ";
  return null;
}
