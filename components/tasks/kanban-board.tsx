"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { moveTaskAction, type TaskStatus } from "@/app/actions/tasks";
import { useRealtime } from "@/components/realtime/use-realtime";
import { KANBAN_COLUMNS } from "@/lib/tasks-meta";
import type { TaskRow } from "@/lib/queries/tasks";
import { PriorityBadge } from "@/components/tasks/priority-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type Grouped = Record<string, TaskRow[]>;

function group(tasks: TaskRow[]): Grouped {
  const g: Grouped = {};
  for (const c of KANBAN_COLUMNS) g[c.key] = [];
  for (const t of tasks) {
    if (g[t.status]) g[t.status].push(t);
  }
  return g;
}

function initials(name: string | null) {
  return (name ?? "؟").split(" ").slice(0, 2).map((p) => p[0]).join("");
}

function Card({ task, canEdit }: { task: TaskRow; canEdit: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled: !canEdit,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "rounded-xl border bg-card p-3 shadow-sm",
        canEdit && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <Link
          href={`/tasks/${task.id}`}
          className="text-sm font-medium leading-snug hover:text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          {task.title}
        </Link>
        <PriorityBadge priority={task.priority} />
      </div>
      <div className="flex items-center justify-between">
        <span className="truncate text-xs text-muted-foreground">{task.workspaceName ?? "—"}</span>
        {task.assigneeName && (
          <Avatar className="size-6">
            {task.assigneeAvatar && <AvatarImage src={task.assigneeAvatar} />}
            <AvatarFallback className="bg-primary/10 text-[10px] text-primary">
              {initials(task.assigneeName)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
    </div>
  );
}

function Column({
  col,
  tasks,
  canEdit,
}: {
  col: { key: string; label: string };
  tasks: TaskRow[];
  canEdit: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.key}` });
  return (
    <div className="flex min-w-[260px] flex-1 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold">{col.label}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {tasks.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[120px] flex-1 flex-col gap-2 rounded-2xl bg-muted/40 p-2 transition-colors",
          isOver && "bg-primary/5 ring-2 ring-primary/30",
        )}
      >
        {tasks.map((t) => (
          <Card key={t.id} task={t} canEdit={canEdit} />
        ))}
        {tasks.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">لا توجد مهام</p>
        )}
      </div>
    </div>
  );
}

export function KanbanBoard({ tasks, canEdit }: { tasks: TaskRow[]; canEdit: boolean }) {
  const [cols, setCols] = useState<Grouped>(() => group(tasks));
  const [activeId, setActiveId] = useState<string | null>(null);
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => setCols(group(tasks)), [tasks]);
  useRealtime((e) => {
    if (e.type === "task_moved") router.refresh();
  });

  const activeTask = useMemo(
    () => Object.values(cols).flat().find((t) => t.id === activeId) ?? null,
    [activeId, cols],
  );

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId || !overId.startsWith("col:")) return;
    const target = overId.slice(4) as TaskStatus;
    const taskId = String(e.active.id);

    const sourceCol = Object.keys(cols).find((k) => cols[k].some((t) => t.id === taskId));
    if (!sourceCol || sourceCol === target) return;

    // Optimistic move.
    setCols((prev) => {
      const task = prev[sourceCol].find((t) => t.id === taskId)!;
      return {
        ...prev,
        [sourceCol]: prev[sourceCol].filter((t) => t.id !== taskId),
        [target]: [{ ...task, status: target }, ...prev[target]],
      };
    });

    moveTaskAction(taskId, target).catch(() => {
      toast.error("تعذّر نقل المهمة");
      router.refresh();
    });
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {KANBAN_COLUMNS.map((col) => (
          <Column key={col.key} col={col} tasks={cols[col.key] ?? []} canEdit={canEdit} />
        ))}
      </div>
      <DragOverlay>
        {activeTask && (
          <div className="rounded-xl border bg-card p-3 shadow-lg">
            <p className="text-sm font-medium">{activeTask.title}</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
