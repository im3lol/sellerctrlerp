"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { attendance } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { getTodaySnapshot, todayStr, workedSeconds, type AttendanceSnapshot } from "@/lib/attendance";
import { publish } from "@/lib/realtime";

const query = (text: string, params: unknown[]) => pool.query(text, params);

async function currentRow(userId: string) {
  const [row] = await db
    .select()
    .from(attendance)
    .where(and(eq(attendance.userId, userId), eq(attendance.workDate, todayStr())))
    .orderBy(desc(attendance.clockIn))
    .limit(1);
  return row ?? null;
}

export async function clockInAction(): Promise<AttendanceSnapshot> {
  const user = await requireUser();
  const existing = await currentRow(user.id);
  // If an open session exists, no-op.
  if (existing && !existing.clockOut) return getTodaySnapshot(user.id);

  await db.insert(attendance).values({
    userId: user.id,
    workDate: todayStr(),
    clockIn: new Date(),
    breaks: [],
  });

  await publish(query, { channel: `user:${user.id}`, type: "attendance", payload: { status: "working" } });
  revalidatePath("/attendance");
  return getTodaySnapshot(user.id);
}

export async function clockOutAction(): Promise<AttendanceSnapshot> {
  const user = await requireUser();
  const row = await currentRow(user.id);
  if (!row || row.clockOut) return getTodaySnapshot(user.id);

  const now = new Date();
  // Close any open break first.
  const breaks = (row.breaks ?? []).map((b) => (b.end === null ? { ...b, end: now.toISOString() } : b));
  const extraBreak = (row.breaks ?? [])
    .filter((b) => b.end === null)
    .reduce((s, b) => s + Math.floor((now.getTime() - new Date(b.start).getTime()) / 1000), 0);
  const breakSeconds = row.breakSeconds + extraBreak;
  const total = workedSeconds(row.clockIn, now, breakSeconds, null, now);

  await db
    .update(attendance)
    .set({ clockOut: now, breaks, breakSeconds, totalSeconds: total, updatedAt: now })
    .where(eq(attendance.id, row.id));

  await publish(query, { channel: `user:${user.id}`, type: "attendance", payload: { status: "out" } });
  revalidatePath("/attendance");
  return getTodaySnapshot(user.id);
}

export async function startBreakAction(): Promise<AttendanceSnapshot> {
  const user = await requireUser();
  const row = await currentRow(user.id);
  if (!row || row.clockOut) return getTodaySnapshot(user.id);
  const breaks = row.breaks ?? [];
  if (breaks.some((b) => b.end === null)) return getTodaySnapshot(user.id); // already on break

  await db
    .update(attendance)
    .set({ breaks: [...breaks, { start: new Date().toISOString(), end: null }], updatedAt: new Date() })
    .where(eq(attendance.id, row.id));

  await publish(query, { channel: `user:${user.id}`, type: "attendance", payload: { status: "break" } });
  revalidatePath("/attendance");
  return getTodaySnapshot(user.id);
}

export async function endBreakAction(): Promise<AttendanceSnapshot> {
  const user = await requireUser();
  const row = await currentRow(user.id);
  if (!row || row.clockOut) return getTodaySnapshot(user.id);

  const now = new Date();
  let added = 0;
  const breaks = (row.breaks ?? []).map((b) => {
    if (b.end === null) {
      added += Math.floor((now.getTime() - new Date(b.start).getTime()) / 1000);
      return { ...b, end: now.toISOString() };
    }
    return b;
  });

  await db
    .update(attendance)
    .set({ breaks, breakSeconds: row.breakSeconds + added, updatedAt: now })
    .where(eq(attendance.id, row.id));

  await publish(query, { channel: `user:${user.id}`, type: "attendance", payload: { status: "working" } });
  revalidatePath("/attendance");
  return getTodaySnapshot(user.id);
}
