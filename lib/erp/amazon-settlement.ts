import * as XLSX from "xlsx";

/**
 * Parser for Amazon's "Transaction view" custom report (Payments → Reports).
 * The file has ~8 preamble/definition lines before the real header row. One row
 * per order line / fee / transfer. Pure/no-DB.
 */

export type SettlementTxn = {
  postedAt: Date | null;
  settlementId: string;
  type: string; // Order | Refund | Transfer | Service Fee | SAFE-T reimbursement | FBA Inventory Fee | …
  orderId: string;
  sku: string;
  description: string;
  quantity: number;
  status: string; // Released | Deferred
  releaseDate: Date | null;
  currency: string | null;
  productSales: number;
  shippingCredits: number;
  promotionalRebates: number;
  sellingFees: number;
  fbaFees: number;
  otherTransactionFees: number;
  other: number;
  total: number;
};

const num = (v: unknown): number => Number(String(v ?? "").replace(/,/g, "").trim()) || 0;
const str = (v: unknown): string => String(v ?? "").trim();

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** Parse Amazon's "1 Jun 2026 5:28:50 PM UTC" timestamp to a Date (UTC). */
export function parseAmazonDate(s: string): Date | null {
  const m = /^(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)\s+UTC$/i.exec(str(s));
  if (!m) return null;
  const day = +m[1], mon = MONTHS[m[2] as keyof typeof MONTHS] ?? MONTHS[(m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()) as keyof typeof MONTHS];
  const year = +m[3];
  let hour = +m[4]; const min = +m[5], sec = +m[6];
  const pm = m[7].toUpperCase() === "PM";
  if (pm && hour < 12) hour += 12;
  if (!pm && hour === 12) hour = 0;
  if (mon === undefined) return null;
  return new Date(Date.UTC(year, mon, day, hour, min, sec));
}

const REQUIRED = ["type", "total", "settlement id"];

export function parseSettlementWorkbook(buf: ArrayBuffer | Buffer): SettlementTxn[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("الملف فارغ");
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
  const headerRow = aoa.findIndex((r) => str(r[0]) === "date/time");
  if (headerRow < 0) throw new Error("الملف لا يبدو تقرير معاملات أمازون (لم يُعثر على صف الرأس)");
  const headers = (aoa[headerRow] as unknown[]).map((h) => str(h));
  const missing = REQUIRED.filter((h) => !headers.includes(h));
  if (missing.length) throw new Error(`أعمدة مفقودة: ${missing.join(", ")}`);
  const col = (name: string) => headers.indexOf(name);
  const c = {
    date: col("date/time"), settlement: col("settlement id"), type: col("type"), order: col("order id"),
    sku: col("sku"), desc: col("description"), qty: col("quantity"),
    ps: col("product sales"), sc: col("shipping credits"), pr: col("promotional rebates"),
    sf: col("selling fees"), fba: col("fba fees"), otf: col("other transaction fees"), other: col("other"),
    total: col("total"), status: col("Transaction Status"), release: col("Transaction Release Date"),
    currency: col("currency"),
  };

  const out: SettlementTxn[] = [];
  for (let i = headerRow + 1; i < aoa.length; i++) {
    const r = aoa[i] as unknown[];
    const type = str(r[c.type]);
    if (!type) continue;
    out.push({
      postedAt: parseAmazonDate(str(r[c.date])),
      settlementId: str(r[c.settlement]),
      type,
      orderId: str(r[c.order]),
      sku: str(r[c.sku]),
      description: str(r[c.desc]),
      quantity: num(r[c.qty]),
      status: str(r[c.status]) || "Released",
      releaseDate: c.release >= 0 ? parseAmazonDate(str(r[c.release])) : null,
      currency: c.currency >= 0 ? (str(r[c.currency]) || null) : null,
      productSales: num(r[c.ps]),
      shippingCredits: num(r[c.sc]),
      promotionalRebates: num(r[c.pr]),
      sellingFees: num(r[c.sf]),
      fbaFees: num(r[c.fba]),
      otherTransactionFees: num(r[c.otf]),
      other: num(r[c.other]),
      total: num(r[c.total]),
    });
  }
  return out;
}

/** Stable per-row key for idempotent import (Amazon rows carry no unique id). */
export function settlementDedupKey(t: SettlementTxn): string {
  return [t.settlementId, t.type, t.orderId, t.sku, t.postedAt?.toISOString() ?? "", t.total.toFixed(2)].join("|");
}

// ── SP-API flat-file V2 settlement report parser ─────────────────────────────
// GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2 is a TAB-separated LONG file: the
// first row per settlement is the summary/deposit (transaction-type blank,
// total-amount = net disbursed), then one row per amount COMPONENT
// (amount-type/amount-description/amount) of each transaction. We pivot the
// components back into the same wide SettlementTxn buckets the poster consumes.

const r2 = (n: number) => Math.round(n * 100) / 100;

export function emptyTxn(settlementId: string, type: string): SettlementTxn {
  return {
    postedAt: null, settlementId, type, orderId: "", sku: "", description: "", quantity: 0,
    status: "Released", releaseDate: null, currency: null, productSales: 0, shippingCredits: 0, promotionalRebates: 0,
    sellingFees: 0, fbaFees: 0, otherTransactionFees: 0, other: 0, total: 0,
  };
}

/** flat-file transaction-type → the workbook `type` the poster understands. */
function mapTxnType(raw: string): string {
  if (raw === "Order") return "Order";
  if (raw === "Refund") return "Refund"; // exact only — chargebacks stay fees (no auto-restock)
  if (raw === "Transfer") return "Transfer";
  return raw; // Service Fee / Adjustment / FBA Inventory Reimbursement → aggregateGL fee branch
}

/** ISO-ish flat-file date → Date (falls back to the workbook's UTC format). */
function parseFlatDate(s: string): Date | null {
  const v = str(s);
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? parseAmazonDate(v) : d;
}

// Which SettlementTxn bucket an amount component lands in. Only Order/Refund rows
// need real bucketing (their receivable vs fee split matters); fee/adjustment txns
// use `total` alone in aggregateGL, so their components collapse into `other`.
type Bucket = "productSales" | "shippingCredits" | "promotionalRebates" | "sellingFees" | "fbaFees" | "otherTransactionFees" | "other";
function bucketOf(amountType: string, desc: string, txnType: string): Bucket {
  if (txnType !== "Order" && txnType !== "Refund") return "other";
  const t = amountType.toLowerCase(), d = desc.toLowerCase();
  if (t === "itemprice" || t === "componentprice") {
    if (d.includes("principal")) return "productSales";
    if (d.includes("shipping")) return "shippingCredits";
    return "other"; // tax / giftwrap / etc — collected on our behalf → receivable
  }
  if (t === "promotion") return "promotionalRebates";
  if (t === "itemfees" || t === "orderfees") {
    return d.includes("fba") || d.includes("fulfillment") ? "fbaFees" : "sellingFees";
  }
  return "other";
}

/**
 * Parse a flat-file V2 settlement report (TSV text) into SettlementTxn[]. Groups
 * component rows per transaction and negates the deposit into a Transfer row so
 * the whole settlement nets to zero in `total` (matches the workbook convention:
 * money leaving the Amazon balance to the bank is negative).
 */
export function parseSettlementFlatFile(tsv: string): SettlementTxn[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t").map((h) => str(h));
  const idx = (name: string) => headers.indexOf(name);
  const c = {
    settlementId: idx("settlement-id"), depositDate: idx("deposit-date"), totalAmount: idx("total-amount"),
    txnType: idx("transaction-type"), orderId: idx("order-id"), adjustmentId: idx("adjustment-id"),
    shipmentId: idx("shipment-id"), amountType: idx("amount-type"), amountDesc: idx("amount-description"),
    amount: idx("amount"), sku: idx("sku"), qty: idx("quantity-purchased"),
    posted: idx("posted-date-time") >= 0 ? idx("posted-date-time") : idx("posted-date"),
    currency: idx("currency"),
  };
  if (c.txnType < 0 || c.amount < 0 || c.totalAmount < 0) throw new Error("تقرير التسويات غير متوقّع (أعمدة مفقودة)");

  const groups = new Map<string, SettlementTxn>();
  let transfer: SettlementTxn | null = null;
  let settlementId = "";
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split("\t");
    const sid = str(f[c.settlementId]);
    if (sid) settlementId = sid;
    const ttypeRaw = str(f[c.txnType]);

    // Summary/deposit row: transaction-type blank, total-amount = net disbursed.
    if (!ttypeRaw) {
      const dep = num(f[c.totalAmount]);
      if (dep !== 0) {
        transfer = transfer ?? emptyTxn(settlementId, "Transfer");
        transfer.total = r2(transfer.total - dep); // negate: money leaves Amazon → bank
        transfer.postedAt = parseFlatDate(f[c.depositDate]) ?? transfer.postedAt;
        transfer.releaseDate = transfer.postedAt;
      }
      continue;
    }

    const type = mapTxnType(ttypeRaw);
    const orderId = str(f[c.orderId]) || (c.adjustmentId >= 0 ? str(f[c.adjustmentId]) : "");
    const sku = c.sku >= 0 ? str(f[c.sku]) : "";
    const postedRaw = c.posted >= 0 ? str(f[c.posted]) : "";
    const key = [type, orderId, sku, c.shipmentId >= 0 ? str(f[c.shipmentId]) : "", postedRaw].join("|");
    let g = groups.get(key);
    if (!g) {
      g = emptyTxn(settlementId, type);
      g.orderId = orderId;
      g.sku = sku;
      g.postedAt = parseFlatDate(postedRaw);
      g.releaseDate = g.postedAt;
      g.quantity = c.qty >= 0 ? num(f[c.qty]) : 0;
      g.currency = c.currency >= 0 ? (str(f[c.currency]) || null) : null;
      groups.set(key, g);
    }
    const amt = num(f[c.amount]);
    const amountDesc = str(f[c.amountDesc]);
    const b = bucketOf(str(f[c.amountType]), amountDesc, type);
    g[b] = r2(g[b] + amt);
    g.total = r2(g.total + amt);
    // Keep the fee description for non-order rows — it's how ads/storage/subscription
    // are told apart later (the fee categorizer reads type + description). Order rows
    // keep it empty; their split lives in the buckets above.
    if (!g.description && type !== "Order" && type !== "Refund" && amountDesc) g.description = amountDesc;
  }

  const out = [...groups.values()];
  if (transfer && transfer.total !== 0) out.push(transfer);
  return out;
}
