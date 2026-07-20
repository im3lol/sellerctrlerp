"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { and, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { journalEntryLines } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";

/** Mark/unmark bank journal lines as reconciled (cleared against the statement).
 *  Flag only — no GL effect. Org-scoped via the parent journal entry. */
export async function setLinesReconciledAction(reconcileIds: string[], unreconcileIds: string[]): Promise<ActionState> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const orgFilter = sql`${journalEntryLines.journalEntryId} in (select id from journal_entries where organization_id = ${auth.orgId})`;
    if (reconcileIds.length) {
      await db.update(journalEntryLines).set({ reconciled: true, reconciledAt: new Date() })
        .where(and(inArray(journalEntryLines.id, reconcileIds), orgFilter));
    }
    if (unreconcileIds.length) {
      await db.update(journalEntryLines).set({ reconciled: false, reconciledAt: null })
        .where(and(inArray(journalEntryLines.id, unreconcileIds), orgFilter));
    }
    revalidatePath("/accounting/reconciliation");
    return { ok: true };
  });
}
