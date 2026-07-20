import { Skeleton } from "@/components/ui/skeleton";
import { StatCardsSkeleton } from "@/components/erp/skeletons";
import { Card, CardContent } from "@/components/ui/card";

export default function AdminLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-40" />
      <StatCardsSkeleton count={4} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardContent className="pt-6"><Skeleton className="h-[160px] w-full" /></CardContent></Card>
        <Card><CardContent className="space-y-3 pt-6">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</CardContent></Card>
      </div>
    </div>
  );
}
