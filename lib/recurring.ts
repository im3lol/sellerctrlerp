import { and, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { taskRecurrences, tasks } from "@/db/schema";
import { notify } from "@/lib/activity";

function advance(date: Date, frequency: "daily" | "weekly" | "monthly"): Date {
  const d = new Date(date);
  if (frequency === "daily") d.setDate(d.getDate() + 1);
  else if (frequency === "weekly") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/** Generate task instances for any recurrence whose nextRunAt is due (§14). */
export async function runDueRecurrences(now = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(taskRecurrences)
    .where(and(eq(taskRecurrences.isActive, true), lte(taskRecurrences.nextRunAt, now)));

  let created = 0;
  for (const r of due) {
    await db.insert(tasks).values({
      workspaceId: r.workspaceId,
      title: r.title,
      description: r.description,
      assigneeId: r.assigneeId,
      priority: r.priority,
      status: "new",
    });
    created++;

    if (r.assigneeId) {
      await notify({
        userId: r.assigneeId,
        type: "task_assigned",
        title: "مهمة متكررة جديدة",
        body: r.title,
        link: "/tasks",
      });
    }

    // Advance nextRunAt past now (catch up if the worker was down).
    let next = advance(r.nextRunAt, r.frequency);
    while (next <= now) next = advance(next, r.frequency);
    await db
      .update(taskRecurrences)
      .set({ nextRunAt: next, lastRunAt: now })
      .where(eq(taskRecurrences.id, r.id));
  }
  return created;
}
