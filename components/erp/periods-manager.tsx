"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setPeriodStatusAction } from "@/app/actions/erp/periods";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";

export type Period = { id: string; name: string; startDate: Date; endDate: Date; status: string };

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  OPEN: { label: "مفتوحة", variant: "default" },
  SOFT_CLOSED: { label: "مقفلة مؤقتاً", variant: "secondary" },
  CLOSED: { label: "مقفلة", variant: "destructive" },
};
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export function PeriodsManager({ periods, canManage }: { periods: Period[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const setStatus = (id: string, status: string) =>
    start(async () => {
      const r = await setPeriodStatusAction(id, status);
      if (r.ok) { toast.success("تم تحديث الفترة"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التحديث");
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>الفترات المالية</CardTitle>
        <CardDescription>إقفال الفترة يمنع ترحيل أي قيد بتاريخ داخلها.</CardDescription>
      </CardHeader>
      <CardContent>
        {periods.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد فترات مالية.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الفترة</TableHead>
                <TableHead className="text-start">من</TableHead>
                <TableHead className="text-start">إلى</TableHead>
                <TableHead className="text-start">الحالة</TableHead>
                {canManage && <TableHead className="text-start">إجراءات</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {periods.map((p) => {
                const st = STATUS[p.status] ?? { label: p.status, variant: "secondary" as const };
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{dt(p.startDate)}</TableCell>
                    <TableCell>{dt(p.endDate)}</TableCell>
                    <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex gap-1">
                          {p.status !== "CLOSED" ? (
                            <Button size="sm" variant="outline" disabled={pending} onClick={() => setStatus(p.id, "CLOSED")}>
                              <Icon name="Lock" className="size-4" />إقفال
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" disabled={pending} onClick={() => setStatus(p.id, "OPEN")}>
                              <Icon name="LockOpen" className="size-4" />إعادة فتح
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
