"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { leaveRequests, employees } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { bulkOp, type BulkOpResult } from "@/lib/erp/bulk-delete";
import { tryRecordAudit } from "@/lib/erp/audit";
import { leaveDays, LEAVE_TYPES } from "@/lib/erp/leave";

export type SaveState = ActionState & { id?: string };

const schema = z.object({
  employeeId: z.string().min(1, "اختر الموظف"),
  leaveType: z.enum(LEAVE_TYPES.map((t) => t.value) as [string, ...string[]]),
  startDate: z.string().min(1, "تاريخ البداية مطلوب"),
  endDate: z.string().min(1, "تاريخ النهاية مطلوب"),
  reason: z.string().optional(),
});

/** Create a leave request as DRAFT (no GL — purely operational). */
export async function createLeaveRequestAction(input: unknown): Promise<SaveState> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const days = leaveDays(d.startDate, d.endDate);
    if (days <= 0) return { error: "تاريخ النهاية يجب أن يكون بعد أو يساوي تاريخ البداية" };

    const [emp] = await db.select({ id: employees.id, fullName: employees.fullName, code: employees.employeeCode })
      .from(employees).where(and(eq(employees.id, d.employeeId), eq(employees.organizationId, auth.orgId))).limit(1);
    if (!emp) return { error: "الموظف غير موجود" };
    const employeeName = emp.fullName || emp.code || "موظف";

    const start = new Date(d.startDate + "T00:00:00");
    try {
      const id = await db.transaction(async (tx) => {
        const number = await nextDocumentNumber(tx, auth.orgId, "LV", start.getFullYear());
        const [row] = await tx.insert(leaveRequests).values({
          organizationId: auth.orgId, number, employeeId: emp.id, employeeName,
          leaveType: d.leaveType, startDate: start, endDate: new Date(d.endDate + "T00:00:00"),
          days, reason: d.reason || null, status: "DRAFT", submittedBy: auth.userId,
        }).returning({ id: leaveRequests.id });
        return row.id;
      });
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "LEAVE_REQUEST", entityId: id, summary: `طلب إجازة لـ ${employeeName} (${days} يوم)` });
      revalidatePath("/hr/leaves");
      return { ok: true, id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر الحفظ" };
    }
  });
}

/** Approve or reject a DRAFT leave request. No GL effect. */
async function setStatus(id: string, status: "APPROVED" | "REJECTED"): Promise<ActionState> {
  const auth = await authorizeErp("hr.post");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [row] = await db.select({ status: leaveRequests.status, number: leaveRequests.number, employeeName: leaveRequests.employeeName })
      .from(leaveRequests).where(and(eq(leaveRequests.id, id), eq(leaveRequests.organizationId, auth.orgId))).limit(1);
    if (!row) return { error: "الطلب غير موجود" };
    if (row.status !== "DRAFT") return { error: "الطلب تم البتّ فيه بالفعل" };
    await db.update(leaveRequests).set({ status, approvedBy: auth.userId, approvedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(leaveRequests.id, id), eq(leaveRequests.organizationId, auth.orgId)));
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: status === "APPROVED" ? "CONFIRM" : "CANCEL", entityType: "LEAVE_REQUEST", entityId: id, entityNumber: row.number, summary: `${status === "APPROVED" ? "اعتماد" : "رفض"} إجازة ${row.number} — ${row.employeeName}` });
    revalidatePath("/hr/leaves");
    return { ok: true };
  });
}

export async function approveLeaveRequestAction(id: string) { return setStatus(id, "APPROVED"); }
export async function rejectLeaveRequestAction(id: string) { return setStatus(id, "REJECTED"); }

/** Delete a DRAFT leave request. */
export async function deleteLeaveRequestAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [row] = await db.select({ status: leaveRequests.status }).from(leaveRequests)
      .where(and(eq(leaveRequests.id, id), eq(leaveRequests.organizationId, auth.orgId))).limit(1);
    if (!row) return { error: "الطلب غير موجود" };
    if (row.status !== "DRAFT") return { error: "لا يمكن حذف طلب تم البتّ فيه" };
    await db.delete(leaveRequests).where(and(eq(leaveRequests.id, id), eq(leaveRequests.organizationId, auth.orgId)));
    revalidatePath("/hr/leaves");
    return { ok: true };
  });
}

/** Bulk approve/reject/delete DRAFT leave requests; ineligible rows skipped. */
export async function bulkLeaveRequestsAction(op: "approve" | "reject" | "delete", ids: string[]): Promise<BulkOpResult> {
  const fn = op === "approve" ? approveLeaveRequestAction : op === "reject" ? rejectLeaveRequestAction : deleteLeaveRequestAction;
  return bulkOp(ids, fn);
}
