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
