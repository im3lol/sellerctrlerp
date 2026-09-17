import { z } from "zod";

/**
 * AI bill reading — the pure half. The model is asked for exactly this shape and nothing
 * else; everything after that (checking the arithmetic, finding the supplier, the items)
 * happens here, on our side. That is the privacy line: the model only ever sees the file
 * the user uploaded — no supplier list, no item catalogue, no ERP data of any kind.
 */

/** The models an owner (or a company with its own key) can pick. The platform's stays unset — feature off — until the owner chooses. */
export const AI_MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5 — الأدق" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 — أرخص بحوالي ٦٠٪" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — الأرخص والأسرع" },
] as const;
export const DEFAULT_AI_MODEL = "claude-opus-5";
export const isAiModel = (m: string) => AI_MODELS.some((x) => x.id === m);

export const BillSchema = z.object({
  kind: z.enum(["goods", "services", "receipt"]).describe("goods = a supplier invoice for items/stock; services = rent, utilities, a service provider's invoice; receipt = a small shop or expense receipt"),
  supplierName: z.string().nullable(),
  supplierTaxNumber: z.string().nullable().describe("the seller's tax registration number, digits only, if printed"),
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable().describe("YYYY-MM-DD"),
  currency: z.string().nullable().describe("ISO 4217 code, e.g. EGP, USD"),
  lines: z.array(z.object({
    description: z.string(),
    code: z.string().nullable().describe("the seller's item code / SKU / barcode for the line, if printed"),
    quantity: z.number(),
    unitPrice: z.number().describe("price per unit before tax"),
    taxRate: z.number().nullable().describe("VAT percent for the line, e.g. 14"),
  })),
  subtotal: z.number().nullable().describe("total before tax"),
  tax: z.number().nullable(),
  total: z.number().nullable().describe("grand total payable"),
});

export type Bill = z.infer<typeof BillSchema>;

const r2 = (n: number) => Math.round(n * 100) / 100;
const off = (a: number, b: number) => Math.abs(a - b) > Math.max(1, Math.abs(b) * 0.01);

/** YYYY-MM-DD when the model gave a real date, else null — the form then asks. */
export function billDate(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

/**
 * What doesn't add up. A read is a draft for a person to check, and these are what they
 * should look at first: lines that don't sum to the subtotal, a total that isn't subtotal
 * plus tax, a line with no quantity or price.
 */
export function billWarnings(b: Bill): string[] {
  const out: string[] = [];
  const lines = r2(b.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  if (b.lines.length === 0) out.push("مفيش بنود اتقرت من الفاتورة");
  if (b.lines.some((l) => !(l.quantity > 0) || !(l.unitPrice >= 0))) out.push("فيه بند من غير كمية أو سعر");
  if (b.subtotal != null && b.lines.length > 0 && off(lines, b.subtotal)) out.push(`مجموع البنود (${lines}) مش مساوي للإجمالي قبل الضريبة (${b.subtotal})`);
  if (b.total != null && b.subtotal != null && off(b.subtotal + (b.tax ?? 0), b.total)) out.push(`الإجمالي (${b.total}) مش مساوي للصافي + الضريبة`);
  if (!billDate(b.invoiceDate)) out.push("تاريخ الفاتورة مش واضح");
  return out;
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
// Arabic letter variants people write interchangeably, plus spacing and punctuation.
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase()
  .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
  .replace(/\b(شركة|مؤسسة|co|company|ltd|llc|inc)\b/g, "")
  .replace(/[^\p{L}\p{N}]+/gu, "");

const codeKey = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "");

export type ReceiptLineRef = { itemId: string; name: string; codes: string[]; quantity: number };
export type PricedLine = { itemId: string; unitPrice: number; taxAmount: number; billLine: number };

/**
 * The bill's prices onto a goods receipt's lines — the third leg of the match, done here
 * rather than by the model. A bill line claims a receipt line by code (the item's own codes
 * and the supplier's SKU), else by name; each receipt line is claimed once. Tax is the
 * bill's rate on the RECEIVED quantity. Receipt lines nobody claims keep the order price;
 * bill lines that claim nothing are reported so the person can see what didn't land.
 */
export function priceReceiptLines(b: Bill, lines: ReceiptLineRef[]): { priced: PricedLine[]; unmatchedBill: number[] } {
  const taken = new Set<string>();
  const priced: PricedLine[] = [];
  const unmatchedBill: number[] = [];
  const claim = (i: number, pick: (l: ReceiptLineRef) => boolean) => {
    const l = lines.find((x) => !taken.has(x.itemId) && pick(x));
    if (!l) return false;
    const bl = b.lines[i];
    taken.add(l.itemId);
    priced.push({ itemId: l.itemId, unitPrice: r2(bl.unitPrice), taxAmount: r2(l.quantity * bl.unitPrice * (bl.taxRate ?? 0) / 100), billLine: i });
    return true;
  };

  b.lines.forEach((bl, i) => {
    const code = codeKey(bl.code);
    const name = norm(bl.description);
    const ok = (code.length >= 3 && claim(i, (l) => l.codes.some((c) => codeKey(c) === code)))
      || (name.length >= 3 && claim(i, (l) => { const n = norm(l.name); return n.length >= 3 && (n === name || n.includes(name) || name.includes(n)); }));
    if (!ok) unmatchedBill.push(i);
  });
  return { priced, unmatchedBill };
}

export type SupplierRef = { id: string; nameAr: string; taxNumber: string | null };

/** The supplier on the bill, among the org's own — tax number first, then the name. */
export function matchSupplier(b: Bill, suppliers: SupplierRef[]): SupplierRef | null {
  const tax = digits(b.supplierTaxNumber);
  if (tax.length >= 6) {
    const byTax = suppliers.find((s) => digits(s.taxNumber) === tax);
    if (byTax) return byTax;
  }
  const name = norm(b.supplierName);
  if (name.length < 3) return null;
  return suppliers.find((s) => norm(s.nameAr) === name)
    ?? suppliers.find((s) => { const n = norm(s.nameAr); return n.length >= 3 && (n.includes(name) || name.includes(n)); })
    ?? null;
}
