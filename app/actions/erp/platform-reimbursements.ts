"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { fbaReimbursements } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { revalidatePath } from "@/lib/safe-revalidate";
import { ensurePlatformReimbursementAccount } from "@/lib/erp/reimbursements-core";
import { ensurePlatformWalletGl } from "@/lib/erp/platform-provision";
import { createManualEntryAction } from "@/app/actions/erp/journal";

// R3: recognise a marketplace reimbursement. Amazon pays the seller back for a lost /
// damaged / disposed unit — an "other income" event linked to the loss. Because a
// reimbursement can ALSO surface in the settlement report, we recognise it as a DRAFT
// journal entry (Dr platform wallet / Cr 4103 تعويضات المنصات) the accountant reviews and
// posts — guarding against double-counting. Inventory-reimbursed units are noted; the
// trader restocks them from أوامر السحب / تسويات المخزون if needed.
export async function confirmReimbursementAction(reimbursementId: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create", "marketplace");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [rb] = await db.select().from(fbaReimbursements)
      .where(and(eq(fbaReimbursements.id, reimbursementId), eq(fbaReimbursements.organizationId, auth.orgId))).limit(1);
    if (!rb) return { error: "التعويض غير موجود" };
    if (rb.status !== "PENDING") return { error: "تمّت معالجته بالفعل" };

    const amount = Number(rb.amountTotal);
    let journalEntryId: string | null = null;
    if (amount > 0) {
      const income = await ensurePlatformReimbursementAccount(auth.orgId);
      const wallet = await ensurePlatformWalletGl(auth.orgId, "1109", "محفظة أمازون");
      if (!income || !wallet) return { error: "تعذّر تجهيز حسابات التعويض" };
      const date = new Date().toISOString().slice(0, 10);
      const jv = await createManualEntryAction({
        date, mode: "draft", reference: rb.reimbursementId,
        description: `تعويض منصة ${rb.reimbursementId}${rb.orderId ? ` — طلب ${rb.orderId}` : ""} — راجِع عدم التكرار مع التسوية`,
        lines: [
          { accountId: wallet, debit: amount, credit: 0, description: `تعويض ${rb.sku ?? ""}` },
          { accountId: income, debit: 0, credit: amount, description: "تعويضات المنصات" },
        ],
      });
      if ("error" in jv) return { error: jv.error };
      journalEntryId = jv.id ?? null;
    }

    await db.update(fbaReimbursements).set({ status: "PROCESSED", journalEntryId, updatedAt: new Date() })
      .where(eq(fbaReimbursements.id, reimbursementId));
    revalidatePath("/sales/marketplace-reimbursements");
    return { ok: true };
  });
}
