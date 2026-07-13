import * as XLSX from "xlsx";
import { parseAmazonWorkbook, groupAmazonOrders, type AmazonOrder } from "@/lib/erp/amazon-import";
import { parseInventoryLedger } from "@/lib/erp/amazon-inventory";
import { round2 } from "@/lib/erp/money";
import type { MarketplaceOrder, MarketplaceInventory, MarketplaceProduct } from "../dto";

// Amazon report bytes → neutral DTOs, reusing the manual-upload parsers as the
// mappers. The SP-API flat-file order report shares the manual "Order Report"
// schema (XLSX.read handles its TSV directly). The FBA ledger detail report is
// tab-separated, so convert it to CSV first for parseInventoryLedger.

export function amazonOrdersToDto(orders: AmazonOrder[]): MarketplaceOrder[] {
  return orders.map((o) => ({
    externalId: o.orderId, date: o.date, status: o.status,
    subtotal: o.subtotal, shippingTotal: o.shippingTotal, total: o.total,
    lines: o.lines.map((l) => ({ code: l.sku, altCode: l.asin, name: l.productName, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, shipping: l.shippingPrice })),
  }));
}

/** Order report bytes (TSV/XLSX/CSV) → MarketplaceOrder[]. */
export function parseOrdersReport(buffer: Buffer): MarketplaceOrder[] {
  const { orders } = groupAmazonOrders(parseAmazonWorkbook(buffer));
  return amazonOrdersToDto(orders);
}

/** FBA ledger-detail report bytes (TSV) → MarketplaceInventory[]. */
export function parseInventoryReport(buffer: Buffer): MarketplaceInventory[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
  const summary = parseInventoryLedger(csv);
  return [...summary.perSku].map(([code, onHand]) => ({ code, title: summary.titles.get(code) ?? "", onHand }));
}

/** Merchant listings report bytes (TSV) → MarketplaceProduct[] (one per seller-sku). */
export function parseListingsReport(buffer: Buffer): MarketplaceProduct[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
  const pick = (row: Record<string, unknown>, ...keys: string[]): string => {
    for (const k of keys) {
      const hit = Object.keys(row).find((h) => h.trim().toLowerCase() === k);
      if (hit && String(row[hit]).trim()) return String(row[hit]).trim();
    }
    return "";
  };
  const out = new Map<string, MarketplaceProduct>();
  for (const r of rows) {
    const code = pick(r, "seller-sku", "sku");
    if (!code) continue;
    const price = Number(pick(r, "price").replace(/,/g, "")) || 0;
    out.set(code, { code, altCode: pick(r, "asin1", "asin"), name: pick(r, "item-name", "product-name"), sellPrice: round2(price) });
  }
  return [...out.values()];
}
