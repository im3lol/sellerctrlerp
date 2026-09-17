import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesInvoices, salesInvoiceLines, salesQuotations, salesQuotationLines, customers, items } from "@/db/schema";
import { fmt, qty, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { renderRichText } from "@/lib/erp/rich-text";
import type { DocumentSheetProps } from "@/components/erp/print/document-sheet";

/**
 * The sheets a customer sees — built once, for the print pages AND the customer link
 * (/d/<token>), so both always show the same document. Call inside the org's scope. They
 * return props, not an async component: an async child would render outside the scope.
 */

type Sheet = Omit<DocumentSheetProps, "backHref">;
type Key = { id: string } | { number: string };

const QUOTE_STATUS: Record<string, string> = { DRAFT: "مسودة", SENT: "مُرسل", ACCEPTED: "مقبول", REJECTED: "مرفوض" };

async function customerOf(id: string | null) {
  if (!id) return undefined;
  const [c] = await db.select({ nameAr: customers.nameAr, phone: customers.phone, address: customers.address })
    .from(customers).where(eq(customers.id, id)).limit(1);
  return c;
}

export async function invoiceSheet(orgId: string, key: Key) {
  const [inv] = await db.select().from(salesInvoices)
    .where(and(
      "id" in key ? eq(salesInvoices.id, key.id) : eq(salesInvoices.number, key.number),
      eq(salesInvoices.organizationId, orgId),
    )).limit(1);
  if (!inv) return null;

  const { org, currency, hiddenFor, footerText } = await loadPrintHeader(orgId);
  const cust = await customerOf(inv.customerId);
  const lines = await db.select({
    qty: salesInvoiceLines.quantity, unitPrice: salesInvoiceLines.unitPrice, discount: salesInvoiceLines.discountAmount,
    total: salesInvoiceLines.totalAmount, code: items.code, name: items.nameAr,
  }).from(salesInvoiceLines).leftJoin(items, eq(items.id, salesInvoiceLines.itemId))
    .where(eq(salesInvoiceLines.salesInvoiceId, inv.id));

  const tax = Number(inv.taxAmount ?? 0);
  const shipping = Number(inv.shippingAmount ?? 0);
  const subtotal = Number(inv.totalAmount) - tax - shipping;
  const paid = Number(inv.paidAmount ?? 0);

  const sheet: Sheet = {
    org, footerText,
    hiddenColumns: hiddenFor("sales-invoice"),
    title: "فاتورة بيع",
    number: inv.number,
    watermark: inv.status === "DRAFT" ? "مسودة" : undefined,
    meta: [
      { label: "التاريخ", value: dt(inv.date) },
      ...(inv.dueDate ? [{ label: "الاستحقاق", value: dt(inv.dueDate) }] : []),
    ],
    parties: cust ? [{ label: "فاتورة إلى", name: cust.nameAr, lines: [cust.address, cust.phone] }] : [],
    columns: [
      { label: "#", width: "5%" },
      { label: "الصنف", width: "42%" },
      { label: "الكمية", align: "center", width: "10%" },
      { label: "السعر", align: "end", width: "14%" },
      { label: "الخصم", align: "end", width: "12%" },
      { label: "الإجمالي", align: "end", width: "17%" },
    ],
    rows: lines.map((l, i) => [
      <span key="i" style={{ color: "#8a93a6" }}>{i + 1}</span>,
      <span key="n">
        <b>{l.name}</b>
        {l.code && <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10.5, marginInlineStart: 6 }}>{l.code}</span>}
      </span>,
      qty(l.qty),
      fmt(l.unitPrice),
      Number(l.discount ?? 0) > 0 ? fmt(l.discount) : "—",
      <b key="t">{fmt(l.total)}</b>,
    ]),
    totals: [
      { label: "الإجمالي الفرعي", value: money(subtotal, currency) },
      ...(shipping > 0 ? [{ label: "الشحن", value: money(shipping, currency) }] : []),
      ...(tax > 0 ? [{ label: `ضريبة القيمة المضافة (${inv.taxPercent}%)`, value: money(tax, currency) }] : []),
      { label: "الإجمالي", value: money(inv.totalAmount, currency), tone: "strong" as const },
      ...(paid > 0 ? [{ label: "المدفوع", value: `− ${money(paid, currency)}`, tone: "success" as const }] : []),
    ],
    balance: { label: "المتبقّي", value: money(inv.balanceDue, currency) },
    note: inv.notes,
  };
  return {
    sheet,
    doc: { id: inv.id, number: inv.number, status: inv.status, balanceDue: Number(inv.balanceDue), balanceText: money(inv.balanceDue, currency) },
  };
}

export async function quotationSheet(orgId: string, key: Key) {
  const [q] = await db.select().from(salesQuotations)
    .where(and(
      "id" in key ? eq(salesQuotations.id, key.id) : eq(salesQuotations.number, key.number),
      eq(salesQuotations.organizationId, orgId),
    )).limit(1);
  if (!q) return null;

  const { org, currency, hiddenFor, footerText } = await loadPrintHeader(orgId);
  const cust = await customerOf(q.customerId);
  const lines = await db.select({
    qty: salesQuotationLines.quantity, unitPrice: salesQuotationLines.unitPrice, discount: salesQuotationLines.discountAmount,
    tax: salesQuotationLines.taxAmount, code: items.code, name: items.nameAr, image: items.image,
  }).from(salesQuotationLines).leftJoin(items, eq(items.id, salesQuotationLines.itemId))
    .where(eq(salesQuotationLines.quotationId, q.id));

  // No stored totals on a quotation — the header carries no total column, so the figures
  // are derived from the lines. The whole-quote discount is the one exception: it is an
  // input, not a derivation, so it comes off the header.
  const lineNet = (l: (typeof lines)[number]) => Number(l.qty ?? 0) * Number(l.unitPrice ?? 0) - Number(l.discount ?? 0);
  const subtotal = lines.reduce((s, l) => s + Number(l.qty ?? 0) * Number(l.unitPrice ?? 0), 0);
  const discount = lines.reduce((s, l) => s + Number(l.discount ?? 0), 0);
  const tax = lines.reduce((s, l) => s + Number(l.tax ?? 0), 0);
  const headerDiscount = Number(q.discountAmount ?? 0);
  // Clamped: a discount larger than the bill must not print a negative total.
  const total = Math.max(0, subtotal - discount + tax - headerDiscount);

  const sheet: Sheet = {
    org, footerText,
    hiddenColumns: hiddenFor("sales-quotation"),
    title: "عرض سعر",
    number: q.number,
    watermark: q.status === "DRAFT" ? "مسودة" : undefined,
    meta: [
      { label: "التاريخ", value: dt(q.date) },
      ...(q.validUntil ? [{ label: "ساري حتى", value: dt(q.validUntil) }] : []),
      { label: "الحالة", value: QUOTE_STATUS[q.status] ?? q.status },
    ],
    parties: cust ? [{ label: "عرض إلى", name: cust.nameAr, lines: [cust.address, cust.phone] }] : [],
    columns: [
      { label: "#", width: "4%" },
      // A normal print column, so it can be switched off in the org's print settings.
      { label: "صورة", align: "center", width: "9%" },
      { label: "الصنف", width: "37%" },
      { label: "الكمية", align: "center", width: "10%" },
      { label: "السعر", align: "end", width: "14%" },
      { label: "الخصم", align: "end", width: "11%" },
      { label: "الإجمالي", align: "end", width: "15%" },
    ],
    rows: lines.map((l, i) => [
      <span key="i" style={{ color: "#8a93a6" }}>{i + 1}</span>,
      // Real <img> (print drops CSS backgrounds, not images), fixed box so a tall picture
      // cannot stretch the row, and nothing when the item has no image. Not lazy: a lazy
      // image can still be unloaded when the print dialog fires.
      <span key="img" style={{ display: "inline-block", width: 36, height: 36, verticalAlign: "middle" }}>
        {l.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={l.image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        ) : null}
      </span>,
      <span key="n">
        <b>{l.name}</b>
        {l.code && <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10.5, marginInlineStart: 6 }}>{l.code}</span>}
      </span>,
      qty(l.qty),
      fmt(l.unitPrice),
      Number(l.discount ?? 0) > 0 ? fmt(l.discount) : "—",
      <b key="t">{fmt(lineNet(l))}</b>,
    ]),
    totals: [
      { label: "الإجمالي الفرعي", value: money(subtotal, currency) },
      ...(discount > 0 ? [{ label: "الخصم", value: `− ${money(discount, currency)}`, tone: "danger" as const }] : []),
      ...(tax > 0 ? [{ label: "الضريبة", value: money(tax, currency) }] : []),
      ...(headerDiscount > 0 ? [{ label: "خصم على الإجمالي", value: `− ${money(headerDiscount, currency)}`, tone: "danger" as const }] : []),
    ],
    balance: { label: "الإجمالي", value: money(total, currency) },
    note: renderRichText(q.notes) ?? (q.validUntil ? `هذا العرض ساري حتى ${dt(q.validUntil)}.` : null),
    signatures: ["إعداد", "اعتماد"],
  };
  return { sheet, doc: { id: q.id, number: q.number, status: q.status } };
}
