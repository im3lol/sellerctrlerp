import Link from "next/link";
import { Package } from "lucide-react";
import { Card } from "@/components/ui/card";
import { myProductProgress } from "@/lib/queries/products";

/**
 * Per-workspace product workload for a user, shown as one progress bar each
 * (instead of one task per product). The remaining count shrinks as products
 * are completed.
 */
export async function ProductProgress({ userId }: { userId: string }) {
  const rows = (await myProductProgress(userId)).filter((r) => r.total > 0);
  if (rows.length === 0) return null;

  return (
    <Card className="mb-4 p-5">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <Package className="size-4 text-primary" />
        تقدّم منتجاتي
      </h2>
      <div className="space-y-3">
        {rows.map((r) => {
          const pct = r.total ? Math.round((r.completed / r.total) * 100) : 0;
          const remaining = r.total - r.completed;
          return (
            <Link
              key={r.workspaceId}
              href={`/workspaces/${r.workspaceId}`}
              className="block rounded-xl border p-3 transition hover:bg-muted/40"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">{r.workspaceName}</span>
                <span className="tabular-nums text-muted-foreground">
                  {r.completed}/{r.total} — متبقّي {remaining}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${pct === 100 ? "bg-emerald-500" : "bg-primary"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
