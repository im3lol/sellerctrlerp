"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { approveRequestAction, rejectRequestAction } from "@/app/actions/admin/subscription-requests";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type SubRequest = { id: string; orgName: string; planName: string; interval: string; price: number; paymentMethod: string; paymentReference: string; createdAt: string };

const METHOD: Record<string, string> = { INSTAPAY: "إنستا باي / محفظة", BANK: "تحويل بنكي", VISA: "فيزا" };

export function RequestsPanel({ requests }: { requests: SubRequest[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (requests.length === 0) return null;

  const approve = (id: string) => start(async () => { const r = await approveRequestAction(id); if ("ok" in r) { toast.success("تم التفعيل"); router.refresh(); } else toast.error(r.error); });
  const reject = (id: string) => start(async () => { const r = await rejectRequestAction(id); if ("ok" in r) { toast.success("تم الرفض"); router.refresh(); } else toast.error(r.error); });

  return (
    <Card className="border-amber-500/40">
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base">طلبات اشتراك قيد المراجعة <Badge variant="secondary">{requests.length}</Badge></CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-start">المؤسسة</TableHead>
              <TableHead className="text-start">الباقة</TableHead>
              <TableHead className="text-start">المبلغ</TableHead>
              <TableHead className="text-start">الدفع</TableHead>
              <TableHead className="text-start">المرجع</TableHead>
              <TableHead className="text-start">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.orgName}</TableCell>
                <TableCell>{r.planName} <span className="text-xs text-muted-foreground">({r.interval === "ANNUAL" ? "سنوي" : "شهري"})</span></TableCell>
                <TableCell className="tabular-nums">{r.price.toLocaleString("ar-EG")} ج.م</TableCell>
                <TableCell className="text-sm">{METHOD[r.paymentMethod] ?? r.paymentMethod}</TableCell>
                <TableCell className="text-sm font-mono" dir="ltr">{r.paymentReference || "—"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" disabled={pending} onClick={() => approve(r.id)}>{pending && <Loader2 className="size-4 animate-spin" />}تفعيل</Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => reject(r.id)} className="text-destructive">رفض</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
