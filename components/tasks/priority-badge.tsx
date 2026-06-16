import { TASK_PRIORITY_AR } from "@/lib/tasks-meta";
import { cn } from "@/lib/utils";

const STYLES: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-primary/10 text-primary",
  high: "bg-amber-100 text-amber-700",
  urgent: "bg-destructive/10 text-destructive",
};

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STYLES[priority])}>
      {TASK_PRIORITY_AR[priority]}
    </span>
  );
}
