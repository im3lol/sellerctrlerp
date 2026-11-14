/**
 * Landed-cost allocation: spread a total import charge (freight + customs +
 * insurance + …) across purchase-order lines, returning the shipping-cost PER
 * UNIT for each line (aligned by index). `eligible` lines share the cost; others
 * get 0. Three methods:
 *  - "value":  proportional to line value (quantity × unitPrice) — the common default.
 *  - "qty":    proportional to quantity → a uniform per-unit charge.
 *  - "weight": proportional to line weight (quantity × weight) — e.g. a price-per-kg
 *              freight cost, weighted by each item's own weight.
 * Pure + deterministic so it can be unit-tested; the PO form and the goods-receipt
 * form both call it to fill a `shippingPerUnit` column (order-level estimate vs.
 * this specific delivery's real cost — see the memory on per-receipt landed cost).
 */
export type LcLine = { quantity: number; unitPrice: number; weight?: number; eligible: boolean };

export type LandedBasisKey = { purchaseReceiptId: string; itemId: string; warehouseId: string };
export const landedLineKey = (line: LandedBasisKey) => `${line.purchaseReceiptId}|${line.itemId}|${line.warehouseId}`;
export type VoucherBasis = LandedBasisKey & { quantity: number; unitPrice: number; weightKg: number };
export type VoucherSelection = { key: string; perUnit?: number };

/** Server and preview share validation and cent-conserving voucher amounts.
 * Selection keys must refer to freshly authorized receipt lines, never client qty/prices. */
export function allocateVoucherLines<T extends VoucherBasis>(basis: T[], total: number, method: "value" | "qty" | "weight" | "manual", selection?: VoucherSelection[]) {
  const keys = new Set(basis.map(landedLineKey));
  if (selection && (new Set(selection.map(s => s.key)).size !== selection.length || selection.some(s => !keys.has(s.key)))) throw new Error("اختيار بنود التكاليف غير صالح");
  const picked = selection ? new Map(selection.map(s => [s.key, s])) : null;
  const lines = basis.filter(l => l.quantity > 0 && (!picked || picked.has(landedLineKey(l))));
  if (!lines.length) throw new Error("اختر صنفًا واحدًا على الأقل لتحميل التكلفة");
  if (method === "manual") {
    const result = lines.map(line => {
      const per = picked?.get(landedLineKey(line))?.perUnit ?? 0;
      if (!Number.isFinite(per) || per < 0 || per > 1e10) throw new Error("أدخل تكلفة وحدة صحيحة وغير سالبة");
      const perUnit = round4(per);
      return { ...line, perUnit, allocatedAmount: Math.round(perUnit * line.quantity * 100) / 100 };
    });
    if (!result.some(l => l.allocatedAmount > 0)) throw new Error("أدخل قيمة تكاليف الاستيراد أولاً");
    return result;
  }
  if (!Number.isFinite(total) || total <= 0) throw new Error("أدخل قيمة تكاليف الاستيراد أولاً");
  const per = allocateLandedPerUnit(lines.map(l => ({ quantity: l.quantity, unitPrice: l.unitPrice, weight: l.weightKg, eligible: true })), total, method);
  if (per.every(p => p === 0)) throw new Error("تعذّر التوزيع بهذه الطريقة — جرّب التوزيع بالكمية");
  const amounts = per.map((p, i) => Math.round(p * lines[i].quantity * 100));
  const last = per.findLastIndex(p => p > 0);
  amounts[last] += Math.round(total * 100) - amounts.reduce((a, b) => a + b, 0);
  if (amounts.some(a => a < 0)) throw new Error("تعذّر توزيع هذه القيمة بدقة على البنود المختارة");
  return lines.map((line, i) => ({ ...line, allocatedAmount: amounts[i] / 100, perUnit: round4(amounts[i] / 100 / line.quantity) }));
}

/** Shared on-hand must only be consumed once across receipts of the same item. */
export function groupLandedAdjustments(lines: { itemId: string; warehouseId: string; quantity: number; amount: number }[]) {
  const grouped = new Map<string, { itemId: string; warehouseId: string; quantity: number; amount: number }>();
  for (const l of lines) {
    const key = `${l.itemId}|${l.warehouseId}`;
    const prev = grouped.get(key);
    if (prev) { prev.quantity += l.quantity; prev.amount = Math.round((prev.amount + l.amount) * 100) / 100; }
    else grouped.set(key, { ...l });
  }
  return [...grouped.values()].map(l => ({ ...l, perUnit: l.quantity > 0 ? l.amount / l.quantity : 0 }));
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function allocateLandedPerUnit(lines: LcLine[], total: number, method: "value" | "qty" | "weight"): number[] {
  if (!(total > 0)) return lines.map(() => 0);

  if (method === "value" || method === "weight") {
    const basis = (l: LcLine) => (method === "value" ? l.unitPrice : (l.weight ?? 0));
    const totBasis = lines.reduce((s, l) => s + (l.eligible && l.quantity > 0 ? l.quantity * basis(l) : 0), 0);
    if (!(totBasis > 0)) return lines.map(() => 0);
    return lines.map((l) => (l.eligible && l.quantity > 0 ? round4((total * ((l.quantity * basis(l)) / totBasis)) / l.quantity) : 0));
  }

  const totQty = lines.reduce((s, l) => s + (l.eligible && l.quantity > 0 ? l.quantity : 0), 0);
  if (!(totQty > 0)) return lines.map(() => 0);
  const per = round4(total / totQty);
  return lines.map((l) => (l.eligible && l.quantity > 0 ? per : 0));
}
