"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setProductStatusAction, assignProductAction } from "@/app/actions/products";
import { StatusBadge } from "@/components/products/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export type StatusOption = { id: string; name: string; color: string };
export type AssigneeOption = { id: string; name: string; avatarUrl: string | null };

export function ProductStatusSelect({
  productId,
  statusId,
  statuses,
  disabled,
}: {
  productId: string;
  statusId: string | null;
  statuses: StatusOption[];
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const current = statuses.find((s) => s.id === statusId);

  if (disabled) return <StatusBadge name={current?.name ?? null} color={current?.color ?? null} />;

  return (
    <Select
      value={statusId ?? undefined}
      onValueChange={(v) =>
        start(async () => {
          try {
            await setProductStatusAction(productId, v);
          } catch {
            toast.error("تعذّر تحديث الحالة");
          }
        })
      }
    >
      <SelectTrigger
        size="sm"
        className="h-8 w-auto gap-1 border-none bg-transparent p-0 shadow-none focus-visible:ring-0 data-[state=open]:bg-accent/50"
        data-pending={pending}
      >
        <StatusBadge name={current?.name ?? "اختر"} color={current?.color ?? null} />
      </SelectTrigger>
      <SelectContent>
        {statuses.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ProductAssigneeSelect({
  productId,
  assignedTo,
  assignees,
  disabled,
}: {
  productId: string;
  assignedTo: string | null;
  assignees: AssigneeOption[];
  disabled?: boolean;
}) {
  const [, start] = useTransition();
  const current = assignees.find((a) => a.id === assignedTo);
  const initials = (name: string) => name.split(" ").slice(0, 2).map((p) => p[0]).join("");

  const Pill = (
    <span className="flex items-center gap-2">
      <Avatar className="size-6">
        {current?.avatarUrl && <AvatarImage src={current.avatarUrl} />}
        <AvatarFallback className="bg-primary/10 text-[10px] text-primary">
          {current ? initials(current.name) : "؟"}
        </AvatarFallback>
      </Avatar>
      <span className="text-sm">{current?.name ?? "غير معيّن"}</span>
    </span>
  );

  if (disabled) return Pill;

  return (
    <Select
      value={assignedTo ?? "none"}
      onValueChange={(v) =>
        start(async () => {
          try {
            await assignProductAction(productId, v === "none" ? null : v);
          } catch {
            toast.error("تعذّر التعيين");
          }
        })
      }
    >
      <SelectTrigger
        size="sm"
        className="h-8 w-auto gap-1 border-none bg-transparent p-0 shadow-none focus-visible:ring-0 data-[state=open]:bg-accent/50"
      >
        {Pill}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">غير معيّن</SelectItem>
        {assignees.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
