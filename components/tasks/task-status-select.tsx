"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { moveTaskAction, type TaskStatus } from "@/app/actions/tasks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TASK_STATUS_AR } from "@/lib/tasks-meta";

const ALL: TaskStatus[] = ["new", "in_progress", "review", "done", "blocked"];

export function TaskStatusSelect({
  taskId,
  status,
  disabled,
}: {
  taskId: string;
  status: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <Select
      value={status}
      disabled={disabled || pending}
      onValueChange={(v) =>
        start(async () => {
          try {
            await moveTaskAction(taskId, v as TaskStatus);
          } catch {
            toast.error("تعذّر تحديث الحالة");
          }
        })
      }
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ALL.map((s) => (
          <SelectItem key={s} value={s}>
            {TASK_STATUS_AR[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
