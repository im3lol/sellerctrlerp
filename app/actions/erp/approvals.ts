"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { decideApproval } from "@/lib/erp/approvals";

/** Approve or reject one request. The rules (who may, a reason for a rejection) live in
 *  decideApproval so the web, and later Telegram, go through exactly one gate. */
export async function decideApprovalAction(requestId: string, decision: "APPROVE" | "REJECT", comment?: string): Promise<ActionState> {
  const auth = await authorizeErp("approvals.decide");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const r = await decideApproval({ ...auth, requestId, decision, comment: comment ?? null });
    if ("error" in r) return { error: r.error };
    revalidatePath("/approvals");
    return { ok: true };
  });
}
