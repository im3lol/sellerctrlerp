import * as XLSX from "xlsx";

/**
 * Parsing helpers for the Amazon "Order Report" flat file (one row per order
 * line item). Pure/no-DB so it can be unit-tested; the server action layer adds
 * SKU→item matching and order creation.
 */

export type AmazonLine = {
  orderId: string;
  purchaseDate: string; // ISO
  status: string; // Pending | Shipped | Cancelled
  sku: string;
  asin: string;
  productName: string;
  qty: number;
  itemPrice: number; // Amazon "item-price" = LINE total (for the whole quantity)
  shippingPrice: number;
};

export type AmazonOrder = {
  orderId: string;
  date: string; // ISO
  status: string;
  lines: {
    sku: string;
    asin: string;
    productName: string;
    qty: number;
    unitPrice: number; // itemPrice / qty
    lineTotal: number; // itemPrice
    shippingPrice: number;
  }[];
  shippingTotal: number;
  subtotal: number;
  total: number;
};

const num = (v: unknown): number => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => String(v ?? "").trim();
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Canonical code form for exact match: uppercase, alphanumerics only. */
export function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const REQUIRED_HEADERS = ["amazon-order-id", "sku", "quantity", "item-price"];

/** Parse the first sheet into raw Amazon lines. Throws if it isn't an order report. */
export function parseAmazonWorkbook(buf: ArrayBuffer | Buffer): AmazonLine[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("الملف فارغ");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
  if (rows.length === 0) throw new Error("لا توجد صفوف في الملف");
  const headers = Object.keys(rows[0]).map((h) => h.trim());
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length) throw new Error(`الملف لا يبدو تقرير طلبات أمازون (أعمدة مفقودة: ${missing.join(", ")})`);

  // Header cells may carry trailing spaces (e.g. "order-item-id "); index by trimmed key.
  const pick = (row: Record<string, unknown>, key: string): unknown => {
    if (key in row) return row[key];
    const k = Object.keys(row).find((kk) => kk.trim() === key);
    return k ? row[k] : "";
  };

  return rows.map((r) => ({
    orderId: str(pick(r, "amazon-order-id")),
    purchaseDate: str(pick(r, "purchase-date")),
    status: str(pick(r, "order-status")),
    sku: str(pick(r, "sku")),
    asin: str(pick(r, "asin")),
    productName: str(pick(r, "product-name")),
    qty: num(pick(r, "quantity")),
    itemPrice: num(pick(r, "item-price")),
    shippingPrice: num(pick(r, "shipping-price")),
  }));
}

/**
 * Group lines into orders, keeping only importable rows: status Pending/Shipped
 * (Cancelled dropped) and quantity > 0. Computes unit price (line total ÷ qty)
 * and order totals (subtotal + shipping).
 */
export function groupAmazonOrders(lines: AmazonLine[]): {
  orders: AmazonOrder[];
  cancelledCount: number;
  zeroQtyCount: number;
} {
  let cancelledCount = 0;
  let zeroQtyCount = 0;
  const byOrder = new Map<string, AmazonOrder>();

  for (const l of lines) {
    if (!l.orderId) continue;
    if (l.status === "Cancelled") { cancelledCount++; continue; }
    if (l.qty <= 0) { zeroQtyCount++; continue; }

    let order = byOrder.get(l.orderId);
    if (!order) {
      order = { orderId: l.orderId, date: l.purchaseDate, status: l.status, lines: [], shippingTotal: 0, subtotal: 0, total: 0 };
      byOrder.set(l.orderId, order);
    }
    const unitPrice = round2(l.itemPrice / l.qty);
    order.lines.push({
      sku: l.sku, asin: l.asin, productName: l.productName,
      qty: l.qty, unitPrice, lineTotal: round2(l.itemPrice), shippingPrice: round2(l.shippingPrice),
    });
  }

  const orders = [...byOrder.values()];
  for (const o of orders) {
    o.subtotal = round2(o.lines.reduce((s, ln) => s + ln.lineTotal, 0));
    o.shippingTotal = round2(o.lines.reduce((s, ln) => s + ln.shippingPrice, 0));
    o.total = round2(o.subtotal + o.shippingTotal);
  }
  return { orders, cancelledCount, zeroQtyCount };
}
