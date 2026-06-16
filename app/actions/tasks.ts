"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "@/lib/db";
import { tasks, taskRecurrences } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { recordActivity, notify } from "@/lib/activity";
import { publish } from "@/lib/realtime";

const query = (text: string, params: unknown[]) => pool.query(text, params);

export type TaskStatus = "new" | "in_progress" | "review" | "done" | "blocked";
export type ActionState = { error?: string; ok?: boolean };

const createSchema = z.object({
  title: z.string().min(2, "العنوان قصير جداً"),
  description: z.string().optional(),
  workspaceId: z.string().uuid().optional().or(z.literal("")),
  assigneeId: z.string().uuid().optional().or(z.literal("")),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  dueDate: z.string().optional(),
});

export async function createTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user.role, "task.manage") && !can(user.role, "task.updateOwn")) {
    return { error: "لا تملك صلاحية إنشاء مهمة" };
  }
  const parsed = createSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    workspaceId: formData.get("workspaceId") || "",
    assigneeId: formData.get("assigneeId") || "",
    priority: formData.get("priority") || "medium",
    dueDate: formData.get("dueDate") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const [task] = await db
    .insert(tasks)
    .values({
      title: d.title,
      description: d.description,
      workspaceId: d.workspaceId || null,
      assigneeId: d.assigneeId || null,
      createdById: user.id,
      priority: d.priority,
      dueDate: d.dueDate ? new Date(d.dueDate) : null,
      status: "new",
    })
    .returning();

  if (d.assigneeId) {
    await notify({
      userId: d.assigneeId,
      type: "task_assigned",
      title: "مهمة جديدة معيّنة لك",
      body: d.title,
      link: `/tasks/${task.id}`,
    });
  }
  await recordActivity({
    actorId: user.id,
    workspaceId: d.workspaceId || null,
    entityType: "task",
    entityId: task.id,
    action: "task.created",
    summaryAr: `${user.name} أنشأ مهمة «${d.title}»`,
  });
  if (d.workspaceId) {
    await publish(query, { channel: `workspace:${d.workspaceId}`, type: "task_moved", payload: { taskId: task.id } });
  }
  revalidatePath("/tasks");
  revalidatePath("/tasks/kanban");
  return { ok: true };
}

export async function moveTaskAction(taskId: string, status: TaskStatus, boardOrder?: number) {
  const user = await requireUser();
  if (!can(user.role, "task.updateOwn")) throw new Error("forbidden");
  const [before] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!before) throw new Error("not found");

  await db
    .update(tasks)
    .set({
      status,
      boardOrder: boardOrder ?? before.boardOrder,
      completedAt: status === "done" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));

  await recordActivity({
    actorId: user.id,
    workspaceId: before.workspaceId,
    entityType: "task",
    entityId: taskId,
    action: "task.status_changed",
    summaryAr: `${user.name} نقل المهمة «${before.title}»`,
  });
  if (before.workspaceId) {
    await publish(query, { channel: `workspace:${before.workspaceId}`, type: "task_moved", payload: { taskId, status } });
  }
  revalidatePath("/tasks");
  revalidatePath("/tasks/kanban");
  revalidatePath(`/tasks/${taskId}`);
}

export async function updateTaskAction(
  taskId: string,
  data: { title?: string; description?: string; assigneeId?: string | null; priority?: string; dueDate?: string | null },
) {
  const user = await requireUser();
  if (!can(user.role, "task.manage")) throw new Error("forbidden");
  const [before] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!before) throw new Error("not found");

  await db
    .update(tasks)
    .set({
      title: data.title ?? undefined,
      description: data.description ?? undefined,
      assigneeId: data.assigneeId === undefined ? undefined : data.assigneeId,
      priority: (data.priority as "low" | "medium" | "high" | "urgent") ?? undefined,
      dueDate: data.dueDate === undefined ? undefined : data.dueDate ? new Date(data.dueDate) : null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));

  if (data.assigneeId && data.assigneeId !== before.assigneeId) {
    await notify({
      userId: data.assigneeId,
      type: "task_assigned",
      title: "تم تعيين مهمة لك",
      body: before.title,
      link: `/tasks/${taskId}`,
    });
  }
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/tasks");
  revalidatePath("/tasks/kanban");
}

export async function deleteTaskAction(taskId: string) {
  const user = await requireUser();
  if (!can(user.role, "task.manage")) throw new Error("forbidden");
  await db.delete(tasks).where(eq(tasks.id, taskId));
  revalidatePath("/tasks");
  revalidatePath("/tasks/kanban");
}

const recurrenceSchema = z.object({
  title: z.string().min(2),
  workspaceId: z.string().uuid().optional().or(z.literal("")),
  assigneeId: z.string().uuid().optional().or(z.literal("")),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  frequency: z.enum(["daily", "weekly", "monthly"]),
});

export async function createRecurrenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!can(user.role, "task.manage")) return { error: "غير مصرّح" };
  const parsed = recurrenceSchema.safeParse({
    title: formData.get("title"),
    workspaceId: formData.get("workspaceId") || "",
    assigneeId: formData.get("assigneeId") || "",
    priority: formData.get("priority") || "medium",
    frequency: formData.get("frequency") || "weekly",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  // First run: next occurrence (tomorrow for daily, +interval otherwise) — simplest: now+1h so it generates soon.
  const next = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(taskRecurrences).values({
    title: d.title,
    workspaceId: d.workspaceId || null,
    assigneeId: d.assigneeId || null,
    priority: d.priority,
    frequency: d.frequency,
    nextRunAt: next,
  });
  revalidatePath("/tasks/recurring");
  return { ok: true };
}

export async function deleteRecurrenceAction(id: string) {
  const user = await requireUser();
  if (!can(user.role, "task.manage")) throw new Error("forbidden");
  await db.delete(taskRecurrences).where(eq(taskRecurrences.id, id));
  revalidatePath("/tasks/recurring");
}
