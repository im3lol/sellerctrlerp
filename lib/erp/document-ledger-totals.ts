/** A lifecycle ledger is not a sum of every document in a sale/purchase chain. */
export type LedgerAmountRow = {
  docType: string; status: string; financialReturn?: boolean;
  qtyTotal: number | null; qtyDelivered?: number | null;
  qtyReceived?: number | null; qtyRejected?: number | null;
  subtotal: number | null; shipping?: number | null;
  discount: number | null; tax: number | null; total: number | null;
};

const approved: Record<string, readonly string[]> = {
  ORDER: ["CONFIRMED", "PARTIALLY_DELIVERED", "DELIVERED", "PARTIALLY_RECEIVED", "RECEIVED", "INVOICED", "CLOSED"],
  DELIVERY: ["DELIVERED", "INVOICED"], RECEIPT: ["RECEIVED", "INVOICED"],
  INVOICE: ["POSTED", "PARTIAL_PAID", "PAID"], RETURN: ["POSTED"],
};

export function documentLedgerTotals(rows: LedgerAmountRow[], type = "") {
  const sums = { qtyTotal: 0, qtyDelivered: 0, qtyReceived: 0, qtyRejected: 0,
    subtotal: 0, shipping: 0, discount: 0, tax: 0, total: 0 };
  for (const row of rows) {
    if (!approved[row.docType]?.includes(row.status)) continue;
    const financialReturn = row.docType === "RETURN" && row.financialReturn === true;
    const counts = type === "RETURN" ? financialReturn
      : type ? row.docType === type : row.docType === "INVOICE" || financialReturn;
    const sign = row.docType === "RETURN" ? -1 : 1;
    if (counts) {
      // Quantity precision is independent of monetary precision. Never add order,
      // delivery and invoice quantities together in the consolidated view.
      sums.qtyTotal += sign * Math.round((row.qtyTotal ?? 0) * 10000);
      if (row.docType !== "RETURN" || financialReturn) {
        for (const key of ["subtotal", "shipping", "discount", "tax", "total"] as const) {
          sums[key] += sign * Math.round((row[key] ?? 0) * 100);
        }
      }
    }
    // Operational columns have their own source, independent of invoicing.
    if (type === "ORDER" && row.docType === "ORDER") {
      sums.qtyDelivered += Math.round((row.qtyDelivered ?? 0) * 10000);
      sums.qtyReceived += Math.round((row.qtyReceived ?? 0) * 10000);
    } else if (!type || row.docType === type) {
      if (row.docType === "DELIVERY") sums.qtyDelivered += Math.round((row.qtyTotal ?? 0) * 10000);
      if (row.docType === "RECEIPT") {
        sums.qtyReceived += Math.round((row.qtyReceived ?? 0) * 10000);
        sums.qtyRejected += Math.round((row.qtyRejected ?? 0) * 10000);
      }
      if (row.docType === "RETURN" && !financialReturn) {
        sums.qtyDelivered -= Math.round((row.qtyDelivered ?? 0) * 10000);
        sums.qtyReceived -= Math.round((row.qtyReceived ?? 0) * 10000);
      }
    }
  }
  return Object.fromEntries(Object.entries(sums).map(([key, value]) =>
    [key, value / (key.startsWith("qty") ? 10000 : 100)])) as typeof sums;
}

export function documentLedgerTotalLabel(type = "") {
  if (type === "ORDER") return "إجمالي أوامر الشراء/البيع المعتمدة";
  if (type === "DELIVERY") return "إجمالي أذون الصرف المعتمدة";
  if (type === "RECEIPT") return "إجمالي أذون الاستلام المعتمدة";
  if (type === "RETURN") return "أثر المرتجعات المعتمدة";
  if (type === "INVOICE") return "إجمالي الفواتير المعتمدة";
  return "صافي الفواتير بعد المرتجعات";
}
