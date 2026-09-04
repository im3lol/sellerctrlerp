"use server";

import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { attendance, employees, users } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { getActiveOrg } from "@/lib/erp/org";
import { tryRecordAudit } from "@/lib/erp/audit";
import { workedSeconds, breakSeconds, validateDay, parseAttendanceCsv, toHours } from "@/lib/erp/attendance";
import { parseCsv } from "@/lib/erp/csv";

/**
 * The three ways a working day gets recorded. The table has existed all along and hourly
 * payroll reads it; until now nothing wrote to it, so every hourly employee was paid for
 * zero hours. All three paths end at the same upsert, keyed by (org, user, date), so a
 * clock-in and a later HR correction edit one row instead of racing to create two.
 */

const dayKey = (d: string) => new Date(d).toISOString().slice(0, 10);

const entrySchema = z.object({
  userId: z.string().min(1, "اختر الموظف"),
  workDate: z.string().min(1, "التاريخ مطلوب"),
  clockIn: z.string().min(1, "وقت الحضور مطلوب"),
  clockOut: z.string().optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable(),
});

/** HR types or corrects one day. */
export async function saveAttendanceAction(input: z.input<typeof entrySchema>): Promise<ActionState> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const err = validateDay({ workDate: d.workDate, clockIn: d.clockIn, clockOut: d.clockOut });
  if (err) return { error: err };

  return withOrgScope(auth.orgId, false, async () => {
    // The employee must belong to THIS org — the user id comes from the client.
    const [emp] = await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.organizationId, auth.orgId), eq(employees.userId, d.userId))).limit(1);
    if (!emp) return { error: "الموظف غير موجود في هذه الشركة" };

    const seconds = workedSeconds({ clockIn: d.clockIn, clockOut: d.clockOut ?? null });
    await upsertDay(auth.orgId, d.userId, dayKey(d.workDate), {
      clockIn: new Date(d.clockIn),
      clockOut: d.clockOut ? new Date(d.clockOut) : null,
      totalSeconds: seconds,
      source: "MANUAL",
      notes: d.notes?.trim() || null,
    });

    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "UPDATE", entityType: "ATTENDANCE",
      entityId: `${d.userId}:${dayKey(d.workDate)}`, entityNumber: dayKey(d.workDate),
      summary: `تسجيل حضور ${dayKey(d.workDate)} (${toHours(seconds)} ساعة)`,
    });
    revalidatePath("/hr/attendance");
    return { ok: true };
  });
}

/** Delete one day (a duplicate, or a day recorded against the wrong person). */
export async function deleteAttendanceAction(userId: string, workDate: string): Promise<ActionState> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    await db.delete(attendance).where(and(
      eq(attendance.organizationId, auth.orgId),
      eq(attendance.userId, userId),
      eq(attendance.workDate, dayKey(workDate)),
    ));
    revalidatePath("/hr/attendance");
    return { ok: true };
  });
}

/**
 * The employee's own check-in / check-out. No hr.* permission: clocking yourself in is
 * not an HR action, and requiring one would mean giving every employee access to
 * everyone's records. Identity comes from the session, so there is no id to tamper with.
 */
export async function clockAction(direction: "IN" | "OUT"): Promise<ActionState & { state?: "IN" | "OUT"; seconds?: number }> {
  const { user, org } = await getActiveOrg();
  if (!user || !org) return { error: "غير مصرح" };

  return withOrgScope(org.id, false, async () => {
    const [emp] = await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.organizationId, org.id), eq(employees.userId, user.id))).limit(1);
    if (!emp) return { error: "حسابك مش مربوط بملف موظف" };

    const today = dayKey(new Date().toISOString());
    const [row] = await db.select().from(attendance).where(and(
      eq(attendance.organizationId, org.id),
      eq(attendance.userId, user.id),
      eq(attendance.workDate, today),
    )).limit(1);

    if (direction === "IN") {
      if (row && !row.clockOut) return { error: "أنت مسجّل حضور بالفعل" };
      // A second check-in on a day already closed reopens it from now; the earlier
      // hours are kept by leaving the original clockIn alone only when there is none.
      await upsertDay(org.id, user.id, today, {
        clockIn: row?.clockIn ?? new Date(),
        clockOut: null,
        totalSeconds: row?.totalSeconds ?? 0,
        source: "CLOCK",
        notes: row?.notes ?? null,
      });
      return { ok: true, state: "IN" };
    }

    if (!row) return { error: "مفيش تسجيل حضور النهارده" };
    if (row.clockOut) return { error: "أنت مسجّل انصراف بالفعل" };
    const now = new Date();
    const seconds = workedSeconds({ clockIn: row.clockIn, clockOut: now }, row.breaks) + (row.totalSeconds ?? 0);
    await upsertDay(org.id, user.id, today, {
      clockIn: row.clockIn,
      clockOut: now,
      totalSeconds: seconds,
      source: "CLOCK",
      notes: row.notes,
    });
    return { ok: true, state: "OUT", seconds };
  });
}

/** Where the signed-in employee stands today, for the button to know what to say. */
export async function getMyClockAction(): Promise<{ linked: boolean; state: "IN" | "OUT" | "NONE"; seconds: number }> {
  const { user, org } = await getActiveOrg();
  if (!user || !org) return { linked: false, state: "NONE", seconds: 0 };

  return withOrgScope(org.id, false, async () => {
    const [emp] = await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.organizationId, org.id), eq(employees.userId, user.id))).limit(1);
    if (!emp) return { linked: false, state: "NONE" as const, seconds: 0 };

    const today = dayKey(new Date().toISOString());
    const [row] = await db.select().from(attendance).where(and(
      eq(attendance.organizationId, org.id),
      eq(attendance.userId, user.id),
      eq(attendance.workDate, today),
    )).limit(1);

    if (!row) return { linked: true, state: "NONE" as const, seconds: 0 };
    if (!row.clockOut) {
      // Show the running total so the button isn't a black box mid-shift.
      return { linked: true, state: "IN" as const, seconds: workedSeconds({ clockIn: row.clockIn, clockOut: new Date() }, row.breaks) };
    }
    return { linked: true, state: "OUT" as const, seconds: row.totalSeconds ?? 0 };
  });
}

/**
 * Import a fingerprint-device export. Matches people by employee code, and reports every
 * row it could not use — an import that quietly drops three rows is how a month of
 * payroll goes wrong without anyone noticing.
 */
export async function importAttendanceCsvAction(csv: string): Promise<
  ActionState & { imported?: number; skipped?: string[] }
> {
  const auth = await authorizeErp("hr.create");
  if ("error" in auth) return auth;

  const { rows, errors } = parseAttendanceCsv(parseCsv(csv));
  if (!rows.length) return { error: errors[0] ?? "الملف فاضي أو مفيش سطور صالحة" };

  return withOrgScope(auth.orgId, false, async () => {
    const codes = [...new Set(rows.map((r) => r.employeeCode))];
    const emps = await db.select({ code: employees.employeeCode, userId: employees.userId })
      .from(employees)
      .where(and(eq(employees.organizationId, auth.orgId), inArray(employees.employeeCode, codes)));
    const byCode = new Map(emps.filter((e) => e.userId).map((e) => [e.code, e.userId!]));

    const skipped = [...errors];
    let imported = 0;

    for (const r of rows) {
      const userId = byCode.get(r.employeeCode);
      if (!userId) { skipped.push(`سطر ${r.lineNumber}: مفيش موظف بكود ${r.employeeCode} (أو مش مربوط بحساب)`); continue; }
      const bad = validateDay({ workDate: r.workDate, clockIn: r.clockIn, clockOut: r.clockOut });
      if (bad) { skipped.push(`سطر ${r.lineNumber}: ${bad}`); continue; }

      await upsertDay(auth.orgId, userId, r.workDate, {
        clockIn: new Date(r.clockIn),
        clockOut: r.clockOut ? new Date(r.clockOut) : null,
        totalSeconds: workedSeconds({ clockIn: r.clockIn, clockOut: r.clockOut }),
        source: "IMPORT",
        notes: null,
      });
      imported++;
    }

    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "ATTENDANCE",
      entityId: `import:${Date.now()}`, entityNumber: String(imported),
      summary: `استيراد حضور: ${imported} يوم${skipped.length ? ` و${skipped.length} سطر متخطّى` : ""}`,
    });
    revalidatePath("/hr/attendance");
    return { ok: true, imported, skipped };
  });
}

/** Days for one month, for the HR screen. */
export async function getAttendanceMonthAction(from: string, to: string): Promise<
  ActionState & {
    days?: { userId: string; name: string; employeeCode: string | null; workDate: string; clockIn: string; clockOut: string | null; seconds: number; source: string; notes: string | null }[];
  }
> {
  const auth = await authorizeErp("hr.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db
      .select({
        userId: attendance.userId, workDate: attendance.workDate,
        clockIn: attendance.clockIn, clockOut: attendance.clockOut,
        totalSeconds: attendance.totalSeconds, breaks: attendance.breaks,
        source: attendance.source, notes: attendance.notes,
        name: users.name, employeeCode: employees.employeeCode, fullName: employees.fullName,
      })
      .from(attendance)
      .leftJoin(users, eq(users.id, attendance.userId))
      .leftJoin(employees, and(eq(employees.userId, attendance.userId), eq(employees.organizationId, auth.orgId)))
      .where(and(
        eq(attendance.organizationId, auth.orgId),
        gte(attendance.workDate, dayKey(from)),
        lte(attendance.workDate, dayKey(to)),
      ))
      .orderBy(desc(attendance.workDate), asc(users.name))
      .limit(1000);

    return {
      ok: true,
      days: rows.map((r) => ({
        userId: r.userId,
        name: r.fullName ?? r.name ?? "—",
        employeeCode: r.employeeCode,
        workDate: r.workDate,
        clockIn: new Date(r.clockIn).toISOString(),
        clockOut: r.clockOut ? new Date(r.clockOut).toISOString() : null,
        // An open day shows what it has so far rather than a bare zero.
        seconds: r.clockOut ? r.totalSeconds : workedSeconds({ clockIn: r.clockIn, clockOut: new Date() }, r.breaks),
        source: r.source,
        notes: r.notes,
      })),
    };
  });
}

/** The single write point every path goes through, keyed by (org, user, day). */
async function upsertDay(
  orgId: string,
  userId: string,
  workDate: string,
  values: { clockIn: Date; clockOut: Date | null; totalSeconds: number; source: string; notes: string | null },
): Promise<void> {
  await db
    .insert(attendance)
    .values({
      organizationId: orgId, userId, workDate,
      clockIn: values.clockIn, clockOut: values.clockOut,
      totalSeconds: values.totalSeconds,
      breakSeconds: 0,
      source: values.source, notes: values.notes,
    })
    .onConflictDoUpdate({
      target: [attendance.organizationId, attendance.userId, attendance.workDate],
      set: {
        clockIn: values.clockIn, clockOut: values.clockOut,
        totalSeconds: values.totalSeconds, source: values.source,
        notes: values.notes, updatedAt: new Date(),
      },
    });
}

export { breakSeconds };
