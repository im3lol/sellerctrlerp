import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/** A row of stat/KPI card placeholders. */
export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}><CardContent className="space-y-2 pt-6">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-16" />
        </CardContent></Card>
      ))}
    </div>
  );
}

/** A table placeholder — header row + n body rows × cols. */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <Card><CardContent className="p-0">
      <div className="flex gap-4 border-b p-3">
        {Array.from({ length: cols }).map((_, i) => <Skeleton key={i} className="h-4 flex-1" />)}
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 p-3">
            {Array.from({ length: cols }).map((_, c) => <Skeleton key={c} className="h-4 flex-1" style={{ opacity: 1 - r * 0.06 }} />)}
          </div>
        ))}
      </div>
    </CardContent></Card>
  );
}

/**
 * Neutral page skeleton — header + a table block. Used as the global (app) fallback,
 * so a heavy route shows structured placeholders instead of a bare centered spinner.
 */
export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <TableSkeleton />
    </div>
  );
}
