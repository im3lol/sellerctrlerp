import Link from "next/link";
import { Package, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WORKSPACE_TYPE_LABELS } from "@/lib/workspaces";

const TYPE_COLORS: Record<string, string> = {
  amazon: "bg-[#FF9900]/15 text-[#b36b00]",
  noon: "bg-[#FEEE00]/25 text-[#8a7f00]",
  brand: "bg-primary/10 text-primary",
  other: "bg-muted text-muted-foreground",
};

export function WorkspaceCard({
  ws,
  productCount,
  memberCount,
  completion,
}: {
  ws: { id: string; name: string; type: string; description: string | null };
  productCount: number;
  memberCount: number;
  completion: number;
}) {
  return (
    <Link href={`/workspaces/${ws.id}`}>
      <Card className="h-full gap-3 p-5 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold">{ws.name}</h3>
          <Badge variant="secondary" className={TYPE_COLORS[ws.type]}>
            {WORKSPACE_TYPE_LABELS[ws.type]}
          </Badge>
        </div>
        {ws.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">{ws.description}</p>
        )}
        <div className="mt-auto flex items-center gap-4 pt-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Package className="size-4" />
            {productCount} منتج
          </span>
          <span className="flex items-center gap-1.5">
            <Users className="size-4" />
            {memberCount} عضو
          </span>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>نسبة الإنجاز</span>
            <span className="font-semibold tabular-nums">{completion}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${completion}%` }} />
          </div>
        </div>
      </Card>
    </Link>
  );
}
