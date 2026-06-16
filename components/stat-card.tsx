import { Icon } from "@/components/icon";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TONES = {
  blue: "bg-primary/10 text-primary",
  yellow: "bg-brand-yellow/15 text-amber-600",
  green: "bg-success/10 text-success",
  purple: "bg-chart-4/10 text-chart-4",
  red: "bg-destructive/10 text-destructive",
  slate: "bg-muted text-muted-foreground",
} as const;

export function StatCard({
  label,
  value,
  icon,
  tone = "blue",
  hint,
}: {
  label: string;
  value: string | number;
  icon: string;
  tone?: keyof typeof TONES;
  hint?: string;
}) {
  return (
    <Card className="flex flex-row items-center gap-4 p-4">
      <div className={cn("grid size-12 shrink-0 place-items-center rounded-2xl", TONES[tone])}>
        <Icon name={icon} className="size-6" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
    </Card>
  );
}
