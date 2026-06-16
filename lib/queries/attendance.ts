import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { attendance, users } from "@/db/schema";
import { workedSeconds, workedSecondsSince } from "@/lib/attendance";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function getAttendanceSummary(userId: string) {
  const [today, week, month] = await Promise.all([
    workedSecondsSince(userId, startOfToday()),
    workedSecondsSince(userId, daysAgo(7)),
    workedSecondsSince(userId, daysAgo(30)),
  ]);
  return { today, week, month };
}

export async function listRecentSessions(userId: string, limit = 14) {
  const rows = await db
    .select()
    .from(attendance)
    .where(eq(attendance.userId, userId))
    .orderBy(desc(attendance.clockIn))
    .limit(limit);

  const now = new Date();
  return rows.map((r) => {
    const open = (r.breaks ?? []).find((b) => b.end === null);
    return {
      id: r.id,
      workDate: r.workDate,
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      breakSeconds: r.breakSeconds,
      worked: r.clockOut
        ? r.totalSeconds
        : workedSeconds(r.clockIn, null, r.breakSeconds, open ? new Date(open.start) : null, now),
    };
  });
}

/** Today's worked seconds for every staff member (managers, §5). */
export async function listTeamToday() {
  const staff = await db
    .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl, role: users.role })
    .from(users)
    .where(eq(users.isActive, true));

  const since = startOfToday();
  const rows = await db
    .select()
    .from(attendance)
    .where(gte(attendance.clockIn, since));

  const now = new Date();
  const byUser = new Map<string, { worked: number; status: string }>();
  for (const r of rows) {
    const open = (r.breaks ?? []).find((b) => b.end === null);
    const w = workedSeconds(r.clockIn, r.clockOut, r.breakSeconds, open ? new Date(open.start) : null, now);
    const prev = byUser.get(r.userId);
    const status = r.clockOut ? "out" : open ? "break" : "working";
    byUser.set(r.userId, { worked: (prev?.worked ?? 0) + w, status });
  }

  return staff
    .filter((s) => s.role !== "client")
    .map((s) => ({
      ...s,
      worked: byUser.get(s.id)?.worked ?? 0,
      status: byUser.get(s.id)?.status ?? "out",
    }))
    .sort((a, b) => b.worked - a.worked);
}
