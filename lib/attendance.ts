import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { attendance } from "@/db/schema";

export type AttendanceStatus = "out" | "working" | "break";

export type AttendanceSnapshot = {
  attendanceId: string | null;
  status: AttendanceStatus;
  clockInAt: string | null; // ISO
  breakSeconds: number; // accumulated completed breaks
  currentBreakStart: string | null; // ISO if currently on break
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Compute worked seconds for a row up to `now`. */
export function workedSeconds(
  clockIn: Date,
  clockOut: Date | null,
  breakSeconds: number,
  currentBreakStart: Date | null,
  now = new Date(),
): number {
  const end = clockOut ?? now;
  const gross = Math.max(0, Math.floor((end.getTime() - clockIn.getTime()) / 1000));
  const openBreak = currentBreakStart
    ? Math.max(0, Math.floor((now.getTime() - currentBreakStart.getTime()) / 1000))
    : 0;
  return Math.max(0, gross - breakSeconds - openBreak);
}

/** Today's live snapshot for the topbar quick toggle. */
export async function getTodaySnapshot(userId: string): Promise<AttendanceSnapshot> {
  const [row] = await db
    .select()
    .from(attendance)
    .where(and(eq(attendance.userId, userId), eq(attendance.workDate, todayStr())))
    .orderBy(desc(attendance.clockIn))
    .limit(1);

  if (!row || row.clockOut) {
    return {
      attendanceId: row?.id ?? null,
      status: "out",
      clockInAt: null,
      breakSeconds: 0,
      currentBreakStart: null,
    };
  }

  const breaks = row.breaks ?? [];
  const open = breaks.find((b) => b.end === null);
  return {
    attendanceId: row.id,
    status: open ? "break" : "working",
    clockInAt: row.clockIn.toISOString(),
    breakSeconds: row.breakSeconds,
    currentBreakStart: open ? open.start : null,
  };
}

/** Aggregate worked seconds over a time window (for dashboards §5). */
export async function workedSecondsSince(userId: string, since: Date): Promise<number> {
  const rows = await db
    .select()
    .from(attendance)
    .where(and(eq(attendance.userId, userId), gte(attendance.clockIn, since)));

  const now = new Date();
  return rows.reduce((sum, r) => {
    const open = (r.breaks ?? []).find((b) => b.end === null);
    return (
      sum +
      workedSeconds(
        r.clockIn,
        r.clockOut,
        r.breakSeconds,
        open ? new Date(open.start) : null,
        now,
      )
    );
  }, 0);
}

export { todayStr };
