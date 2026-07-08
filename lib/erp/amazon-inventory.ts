import { parseCsv } from "@/lib/erp/csv";

/**
 * Parse an Amazon FBA Inventory Ledger report (CSV, "Summary" or "Detailed").
 * Columns: Date, FNSKU, ASIN, MSKU, Title, Event Type, Reference ID, Quantity,
 * Fulfillment Center, Disposition, Reason, ... The ending on-hand per seller SKU
 * (MSKU) is the signed sum of Quantity across all events (Receipts +, Shipments −,
 * VendorReturns/Removals −, CustomerReturns +, adjustments ±).
 */
export type LedgerSummary = {
  perSku: Map<string, number>;                         // MSKU → net on-hand
  titles: Map<string, string>;                         // MSKU → product title
  events: Record<string, { n: number; qty: number }>;  // Event Type → count + net qty
  totalUnits: number;
  rowCount: number;
};

export function parseInventoryLedger(text: string): LedgerSummary {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("الملف فارغ أو بلا بيانات");
  const h = rows[0].map((c) => c.trim().toLowerCase());
  const col = (...names: string[]) => h.findIndex((c) => names.includes(c));
  const iMsku = col("msku", "seller sku", "sku");
  const iQty = col("quantity", "qty");
  const iEvent = col("event type", "eventtype");
  const iTitle = col("title", "product name");
  if (iMsku < 0 || iQty < 0) throw new Error("الملف لا يبدو تقرير دفتر مخزون أمازون (أعمدة MSKU/Quantity مفقودة)");

  const perSku = new Map<string, number>();
  const titles = new Map<string, string>();
  const events: Record<string, { n: number; qty: number }> = {};
  let totalUnits = 0, rowCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sku = (r[iMsku] ?? "").trim();
    if (!sku) continue;
    const qty = Number(String(r[iQty] ?? "").replace(/,/g, "").trim()) || 0;
    perSku.set(sku, (perSku.get(sku) ?? 0) + qty);
    if (iTitle >= 0 && !titles.has(sku) && r[iTitle]) titles.set(sku, r[iTitle].trim());
    if (iEvent >= 0) {
      const ev = (r[iEvent] ?? "").trim() || "(بلا نوع)";
      events[ev] = events[ev] ?? { n: 0, qty: 0 };
      events[ev].n++; events[ev].qty += qty;
    }
    totalUnits += qty;
    rowCount++;
  }
  return { perSku, titles, events, totalUnits, rowCount };
}
