"use server";

import { and, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import {
  aiCaptures, documentAttachments, expenses, items, itemCodes, purchaseInvoices, purchaseInvoiceLines,
  purchaseReceipts, supplierItems, suppliers,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { buildStorageKey, putObject } from "@/lib/storage";
import { aiAccess, readBill, READABLE_TYPES } from "@/lib/erp/ai-reader";
import { billDate, billWarnings, matchSupplier, priceReceiptLines, type Bill } from "@/lib/erp/ai-bill";
import { convertReceiptToInvoiceAction, } from "@/app/actions/erp/goods-receipts";
import { updatePurchaseInvoiceAction } from "@/app/actions/erp/purchase-invoices";
import { createExpenseAction } from "@/app/actions/erp/expenses";

/**
 * Read a bill with AI, then turn it — only when a person says so — into a DRAFT purchase
 * invoice (from the supplier's goods receipt, the one purchase cycle) or a DRAFT expense.
 * The file goes to private storage, the model sees only that file, and every read is
 * logged in ai_captures with what it cost.
 */

const MAX_BYTES = 8 * 1024 * 1024;

export type BillReceipt = { id: string; number: string; date: string };
export type ReadBillResult = ActionState & {
  captureId?: string; bill?: Bill; warnings?: string[];
  supplier?: { id: string; nameAr: string } | null;
  receipts?: BillReceipt[];
};

/** Whoever can create either document a bill becomes may read one. */
async function authorizeBill() {
  const p = await authorizeErp("purchases.create");
  return "error" in p ? authorizeErp("accounting.create") : p;
}

export async function readBillAction(form: FormData): Promise<ReadBillResult> {
  const auth = await authorizeBill();
  if ("error" in auth) return auth;

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "اختار ملف الفاتورة" };
  if (!(READABLE_TYPES as readonly string[]).includes(file.type)) return { error: "الملف لازم يكون PDF أو صورة (JPG / PNG / WEBP)" };
  if (file.size > MAX_BYTES) return { error: "الملف أكبر من ٨ ميجا — صوّره أو صغّره" };

  const access = await aiAccess(auth.orgId);
  if ("error" in access) return access;

  const data = Buffer.from(await file.arrayBuffer());
  const storageKey = await putObject(buildStorageKey(auth.orgId, file.name), data, file.type, { private: true });
  const base = {
    organizationId: auth.orgId, userId: auth.userId, fileName: file.name, mimeType: file.type, fileSize: file.size,
    storageKey, model: access.model, ownKey: access.ownKey,
  };

  let read: Awaited<ReturnType<typeof readBill>>;
  try {
    read = await readBill(access, { data, mimeType: file.type });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تعذّرت القراءة";
    await withOrgScope(auth.orgId, false, () => db.insert(aiCaptures).values({ ...base, status: "FAILED", error: msg.slice(0, 300) }));
    return { error: msg };
  }

  return withOrgScope(auth.orgId, false, async () => {
    const [cap] = await db.insert(aiCaptures).values({
      ...base, status: "DONE", result: read.bill, inputTokens: read.inputTokens, outputTokens: read.outputTokens,
    }).returning({ id: aiCaptures.id });

    // Matching happens here, against the org's own suppliers — none of this went to the model.
    const list = await db.select({ id: suppliers.id, nameAr: suppliers.nameAr, taxNumber: suppliers.taxNumber })
      .from(suppliers).where(and(eq(suppliers.organizationId, auth.orgId), eq(suppliers.isActive, true)));
    const supplier = matchSupplier(read.bill, list);
    // Found by name, and the bill prints a tax number the supplier doesn't have yet: keep it,
    // so the next bill from them matches on the number.
    const tax = (read.bill.supplierTaxNumber ?? "").replace(/\D/g, "");
    if (supplier && !supplier.taxNumber && tax.length >= 6) {
      await db.update(suppliers).set({ taxNumber: tax }).where(eq(suppliers.id, supplier.id));
    }
    const receipts = supplier ? await db.select({ id: purchaseReceipts.id, number: purchaseReceipts.number, date: purchaseReceipts.date })
      .from(purchaseReceipts)
      .where(and(
        eq(purchaseReceipts.organizationId, auth.orgId), eq(purchaseReceipts.supplierId, supplier.id),
        notInArray(purchaseReceipts.status, ["DRAFT", "CANCELLED"]), isNull(purchaseReceipts.purchaseInvoiceId),
      ))
      .orderBy(desc(purchaseReceipts.date)).limit(20) : [];

    return {
      ok: true, captureId: cap.id, bill: read.bill, warnings: billWarnings(read.bill),
      supplier: supplier ? { id: supplier.id, nameAr: supplier.nameAr } : null,
      receipts: receipts.map((r) => ({ id: r.id, number: r.number, date: new Date(r.date).toISOString().slice(0, 10) })),
    };
  });
}

/** A capture this org read and hasn't turned into anything yet. */
async function openCapture(orgId: string, captureId: string) {
  const [cap] = await db.select().from(aiCaptures)
    .where(and(eq(aiCaptures.id, captureId), eq(aiCaptures.organizationId, orgId), eq(aiCaptures.status, "DONE"))).limit(1);
  if (!cap) return { error: "القراءة دي مش موجودة" } as const;
  if (cap.entityId) return { error: "القراءة دي اتحوّلت لمستند قبل كده" } as const;
  return { cap, bill: cap.result as Bill } as const;
}

async function attach(orgId: string, userId: string, cap: typeof aiCaptures.$inferSelect, entityType: string, entityId: string) {
  await db.insert(documentAttachments).values({
    organizationId: orgId, entityType, entityId, fileName: cap.fileName, fileSize: cap.fileSize,
    mimeType: cap.mimeType, storageKey: cap.storageKey, uploadedBy: userId,
  });
  await db.update(aiCaptures).set({ entityType, entityId }).where(eq(aiCaptures.id, cap.id));
}

/**
 * Goods bill → the receipt's DRAFT purchase invoice, priced at the bill. Quantities stay as
 * received (updatePurchaseInvoiceAction only takes price and tax); the difference from the
 * order price is the usual price variance at posting.
 */
export async function billToInvoiceAction(captureId: string, receiptId: string): Promise<ActionState & { number?: string; unmatched?: number }> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;
  const found = await withOrgScope(auth.orgId, false, () => openCapture(auth.orgId, captureId));
  if ("error" in found) return found;
  const { bill } = found;

  const note = `فاتورة المورد ${bill.invoiceNumber ?? ""} — مقروءة بالذكاء الاصطناعي`.replace("  ", " ");
  const conv = await convertReceiptToInvoiceAction(receiptId, billDate(bill.invoiceDate) ?? undefined, note);
  if (!conv.ok || !conv.invoiceId) return { error: conv.error ?? "تعذّر إنشاء الفاتورة" };
  const invoiceId = conv.invoiceId;

  const { lines, supplierId, number } = await withOrgScope(auth.orgId, false, async () => {
    const [inv] = await db.select({ number: purchaseInvoices.number, supplierId: purchaseInvoices.supplierId })
      .from(purchaseInvoices).where(eq(purchaseInvoices.id, invoiceId)).limit(1);
    const rows = await db.select({ itemId: purchaseInvoiceLines.itemId, quantity: purchaseInvoiceLines.quantity, name: items.nameAr })
      .from(purchaseInvoiceLines).innerJoin(items, eq(items.id, purchaseInvoiceLines.itemId))
      .where(eq(purchaseInvoiceLines.purchaseInvoiceId, invoiceId));
    const ids = rows.map((r) => r.itemId);
    const codes = ids.length ? await db.select({ itemId: itemCodes.itemId, code: itemCodes.code }).from(itemCodes)
      .where(and(eq(itemCodes.organizationId, auth.orgId), inArray(itemCodes.itemId, ids))) : [];
    const skus = ids.length ? await db.select({ itemId: supplierItems.itemId, code: supplierItems.supplierSku }).from(supplierItems)
      .where(and(eq(supplierItems.organizationId, auth.orgId), eq(supplierItems.supplierId, inv.supplierId), inArray(supplierItems.itemId, ids))) : [];
    return {
      number: inv.number, supplierId: inv.supplierId,
      lines: rows.map((r) => ({
        itemId: r.itemId, name: r.name ?? "", quantity: Number(r.quantity),
        codes: [...codes, ...skus].filter((c) => c.itemId === r.itemId && c.code).map((c) => c.code!),
      })),
    };
  });
  void supplierId;

  const { priced, unmatchedBill } = priceReceiptLines(bill, lines);
  if (priced.length > 0) {
    const up = await updatePurchaseInvoiceAction(invoiceId, { lines: priced.map((p) => ({ itemId: p.itemId, unitPrice: p.unitPrice, taxAmount: p.taxAmount })), notes: note });
    if (!up.ok) return { error: `الفاتورة ${number} اتعملت، بس الأسعار ماتحدّثتش: ${up.error ?? ""}`, number };
  }
  await withOrgScope(auth.orgId, false, () => attach(auth.orgId, auth.userId, found.cap, "PURCHASE_INVOICE", invoiceId));
  return { ok: true, number, unmatched: unmatchedBill.length };
}

/** Service bill or receipt → a DRAFT expense, with the accounts the person picked. */
export async function billToExpenseAction(captureId: string, input: { expenseAccountId: string; cashAccountId: string }): Promise<ActionState & { number?: string }> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  const found = await withOrgScope(auth.orgId, false, () => openCapture(auth.orgId, captureId));
  if ("error" in found) return found;
  const { bill } = found;

  const amount = bill.total ?? Math.round((bill.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) + (bill.tax ?? 0)) * 100) / 100;
  const r = await createExpenseAction({
    expenseAccountId: input.expenseAccountId, cashAccountId: input.cashAccountId, amount,
    date: billDate(bill.invoiceDate) ?? new Date().toISOString().slice(0, 10),
    payee: bill.supplierName ?? undefined, reference: bill.invoiceNumber ?? undefined,
    notes: "مقروءة بالذكاء الاصطناعي",
  });
  if (!r.ok || !r.id) return { error: r.error ?? "تعذّر إنشاء المصروف" };
  const expenseId = r.id;
  const number = await withOrgScope(auth.orgId, false, async () => {
    await attach(auth.orgId, auth.userId, found.cap, "EXPENSE", expenseId);
    const [e] = await db.select({ number: expenses.number }).from(expenses).where(eq(expenses.id, expenseId)).limit(1);
    return e?.number;
  });
  return { ok: true, number };
}
