"use server";

import { and, eq } from "drizzle-orm";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { db } from "@/lib/db";
import { purchaseReceipts, purchaseInvoices, deliveryNotes, landedCostVouchers, purchaseOrders, salesOrders, purchaseReturns, salesReturns, paymentVouchers, receiptVouchers } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { recordAudit } from "@/lib/erp/audit";
import { dependentsList } from "@/lib/erp/doc-dependents";
import { cancelledDocReferences, ledgerSafeToPurge, purgeDocument, DOC_LABEL, PURGEABLE_STATUSES, type DocKind } from "@/lib/erp/doc-delete";

/** Where each kind lives: its table, the capability to delete it, and its list page. */
const KINDS = {
  receipt: { table: purchaseReceipts, cap: "purchases.confirm", path: "/purchases/receipts", entity: "GOODS_RECEIPT" },
  invoice: { table: purchaseInvoices, cap: "accounting.post", path: "/purchases/invoices", entity: "PURCHASE_INVOICE" },
  delivery: { table: deliveryNotes, cap: "sales.confirm", path: "/sales/deliveries", entity: "DELIVERY_NOTE" },
  landedCost: { table: landedCostVouchers, cap: "purchases.confirm", path: "/purchases/landed-costs", entity: "LANDED_COST" },
  purchaseOrder: { table: purchaseOrders, cap: "purchases.confirm", path: "/purchases/orders", entity: "PURCHASE_ORDER" },
  salesOrder: { table: salesOrders, cap: "sales.confirm", path: "/sales/orders", entity: "SALES_ORDER" },
  purchaseReturn: { table: purchaseReturns, cap: "purchases.confirm", path: "/purchases/returns", entity: "PURCHASE_RETURN" },
  salesReturn: { table: salesReturns, cap: "sales.confirm", path: "/sales/returns", entity: "SALES_RETURN" },
  paymentVoucher: { table: paymentVouchers, cap: "purchases.pay", path: "/purchases/payments", entity: "PAYMENT_VOUCHER" },
  receiptVoucher: { table: receiptVouchers, cap: "sales.collect", path: "/sales/receipts", entity: "RECEIPT_VOUCHER" },
} as const;

/**
 * Permanently erase a CANCELLED document — the "I entered it by mistake, get it out of my
 * face" action, as opposed to cancelling (which only zeroes its effect and keeps the paper
 * trail). Refuses, naming the documents, while anything still points at it, and refuses
 * when erasing its stock movements would corrupt the ledger's running balances.
 *
 * Only ever touches a document whose effect is already nil: cancel first, then delete.
 */
export async function deleteCancelledDocumentAction(kind: DocKind, id: string): Promise<ActionState> {
  const cfg = KINDS[kind];
  if (!cfg) return { error: "نوع مستند غير معروف" };

  const auth = await authorizeErp(cfg.cap);
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const t = cfg.table;
    const [doc] = await db.select({ id: t.id, number: t.number, status: t.status }).from(t)
      .where(and(eq(t.id, id), eq(t.organizationId, auth.orgId))).limit(1);
    if (!doc) return { error: "المستند غير موجود" };
    if (!PURGEABLE_STATUSES.includes(doc.status)) {
      return { error: `يمكن حذف ${DOC_LABEL[kind]} بعد إلغائه فقط — ألغِه أولاً ثم احذفه.` };
    }

    const refs = await cancelledDocReferences(auth.orgId, kind, id);
    if (refs.length) {
      return { error: `لا يمكن حذف ${DOC_LABEL[kind]} — لا يزال مرتبطاً بـ: ${dependentsList(refs)}. عالِج هذه المستندات أولاً.` };
    }

    const safe = await ledgerSafeToPurge(auth.orgId, id);
    if (!safe.ok) return { error: safe.error };

    try {
      await db.transaction(async (tx) => {
        // Re-read the status under lock: a concurrent re-open would otherwise let us
        // delete a document that is live again.
        const [live] = await tx.select({ status: t.status }).from(t)
          .where(and(eq(t.id, id), eq(t.organizationId, auth.orgId))).limit(1).for("update");
        if (!live || !PURGEABLE_STATUSES.includes(live.status)) throw new Error("تغيّرت حالة المستند — حدّث الصفحة");

        // The audit row is written BEFORE the purge, because purging deletes this
        // document's own audit rows — this one is keyed to the org, not the entity.
        await recordAudit(tx, {
          orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: cfg.entity,
          entityId: `deleted:${id}`, entityNumber: doc.number,
          summary: `حذف نهائي لـ${DOC_LABEL[kind]} ${doc.number} (كان ملغياً)`,
        });
        await purgeDocument(tx, auth.orgId, kind, id);
      });
      revalidatePath(cfg.path);
      revalidatePath("/purchases/orders");
      revalidatePath("/accounting/journal");
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر الحذف" };
    }
  });
}

/**
 * What is blocking a delete, for the UI to show before the user clicks. Returns an empty
 * list when the document can be erased.
 */
export async function getDeleteBlockersAction(kind: DocKind, id: string): Promise<
  ActionState & { blockers?: { label: string; number: string; href: string }[]; ledgerError?: string }
> {
  const cfg = KINDS[kind];
  if (!cfg) return { error: "نوع مستند غير معروف" };
  const auth = await authorizeErp("purchases.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const blockers = await cancelledDocReferences(auth.orgId, kind, id);
    const safe = await ledgerSafeToPurge(auth.orgId, id);
    return { ok: true, blockers, ledgerError: safe.ok ? undefined : safe.error };
  });
}
