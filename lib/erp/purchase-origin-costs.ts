import { round2, round4 } from "./money";

export type OriginCost = {
  kind: "MARKETPLACE_TAX" | "DOMESTIC_FREIGHT" | "PREP" | "OTHER" | "DISCOUNT";
  amount: number;
  allocationMethod: "VALUE" | "QUANTITY" | "MANUAL";
  description: string;
  manual: Record<string, number>;
};
export type OriginLine = {
  itemId: string; quantity: number; unitPrice: number; shippingPerUnit: number;
  discountAmount: number; taxAmount: number; exempt: boolean;
  uomId?: string; uomFactor: number;
};
/** Original document-currency inputs, before allocation; never edit loaded prices twice. */
export type OriginCostInput = { lines: OriginLine[]; costs: OriginCost[] };

export type OriginShare = { shipping: number; discount: number; tax: number; other: number };
export const emptyOriginShare = (): OriginShare => ({ shipping: 0, discount: 0, tax: 0, other: 0 });

export function allocateOriginShares(lines: OriginLine[], costs: OriginCost[], rate = 1): OriginShare[] {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("سعر الصرف غير صالح");
  if (lines.some(l => !Number.isFinite(l.quantity) || l.quantity <= 0)) throw new Error("الكمية يجب أن تكون أكبر من صفر");
  if (costs.length && new Set(lines.map(l => l.itemId)).size !== lines.length) throw new Error("اجمع الصنف المتكرر في بند واحد قبل توزيع المصاريف");
  const shares = lines.map(emptyOriginShare);
  for (const cost of costs) {
    if (!Number.isFinite(cost.amount) || cost.amount < 0) throw new Error("قيمة المصروف غير صالحة");
    let weights: number[];
    if (cost.allocationMethod === "MANUAL") {
      if (Object.entries(cost.manual).some(([id, amount]) => !Number.isFinite(amount) || amount < 0 || (amount > 0 && !lines.some(l => l.itemId === id)))) throw new Error("راجع مبالغ التوزيع اليدوي والأصناف");
      weights = lines.map(l => cost.manual[l.itemId] ?? 0);
      if (Math.abs(round2(weights.reduce((s, n) => s + n, 0)) - round2(cost.amount)) > 0.001) throw new Error("مجموع التوزيع اليدوي يجب أن يساوي قيمة المصروف أو الخصم");
    } else {
      weights = lines.map(l => cost.allocationMethod === "QUANTITY" ? l.quantity : Math.max(0, l.quantity * l.unitPrice - l.discountAmount));
    }
    const totalWeight = weights.reduce((s, n) => s + n, 0);
    if (!cost.amount) continue;
    if (!totalWeight) throw new Error("لا يمكن التوزيع على قيمة صفر — اختر حسب الكمية أو يدويًا");
    const amount = round4(cost.amount * rate);
    let remaining = amount;
    const last = weights.findLastIndex(w => w > 0);
    weights.forEach((weight, i) => {
      const part = i === last ? remaining : round4(amount * weight / totalWeight);
      const key = cost.kind === "DISCOUNT" ? "discount" : cost.kind === "DOMESTIC_FREIGHT" ? "shipping" : cost.kind === "MARKETPLACE_TAX" ? "tax" : "other";
      shares[i][key] = round4(shares[i][key] + part);
      remaining = round4(remaining - part);
    });
  }
  return shares;
}

export function allocateOriginCosts(lines: OriginLine[], costs: OriginCost[], rate: number) {
  const shares = allocateOriginShares(lines, costs, rate);
  return lines.map((l, i) => {
    // Load the order's cost into purchase price, not receipt freight: overriding
    // delivery freight must not erase origin-country costs. Receipt/invoice/GRNI
    // therefore use the same price, including for partial receipts.
    const unitPrice = round4(l.unitPrice * rate + (shares[i].shipping + shares[i].tax + shares[i].other - shares[i].discount) / l.quantity);
    const shippingPerUnit = round4(l.shippingPerUnit * rate);
    const discountAmount = round4(l.discountAmount * rate);
    const taxAmount = round4(l.taxAmount * rate);
    if (unitPrice < 0 || unitPrice * l.quantity + 0.0001 < discountAmount) throw new Error("الخصم أكبر من قيمة أحد الأصناف — راجع التوزيع");
    return { ...l, unitPrice, shippingPerUnit, discountAmount, taxAmount,
      totalAmount: round2(l.quantity * (unitPrice + shippingPerUnit) - discountAmount + taxAmount) };
  });
}

/** Document-facing cells: preserve the supplier price and expose every charge by kind. */
export function originDisplayLines(input: OriginCostInput, rate = 1) {
  const shares = allocateOriginShares(input.lines, input.costs, rate);
  return input.lines.map((l, i) => ({
    ...l,
    unitPrice: round4(l.unitPrice * rate),
    shippingPerUnit: round4(l.shippingPerUnit * rate + shares[i].shipping / l.quantity),
    discountAmount: round4(l.discountAmount * rate + shares[i].discount),
    taxAmount: round4(l.taxAmount * rate + shares[i].tax),
    otherAmount: shares[i].other,
    totalAmount: round2((l.quantity * (l.unitPrice + l.shippingPerUnit) - l.discountAmount + l.taxAmount) * rate + shares[i].shipping + shares[i].tax + shares[i].other - shares[i].discount),
  }));
}
