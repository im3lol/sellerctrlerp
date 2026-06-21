"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { bulkReceiptsAction } from "@/app/actions/erp/goods-receipts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";

const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  RECEIVED: { label: "تم الاستلام", variant: "default" },
  INVOICED: { label: "مفوتر", variant: "default" },
};

type Row = { id: string; number: string; date: Date; supplier: string | null; order: string | null; invoice: string | null; status: string };

export function GoodsReceiptsTable({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());

  // DRAFT → confirm/delete; RECEIVED → bill. INVOICED → nothing to do.
  const eligible = rows.filter((r) => r.status !== "INVOICED").map((r) => r.id);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = eligible.length > 0 && eligible.every((id) => sel.has(id));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(eligible));

  const selRows = rows.filter((r) => sel.has(r.id));
  const hasDraft = selRows.some((r) => r.status === "DRAFT");
  const hasReceived = selRows.some((r) => r.status === "RECEIVED");

  const run = (op: "confirm" | "bill" | "delete", verb: string) =>
    start(async () => {
      const r = await bulkReceiptsAction(op, [...sel]);
      if (r.ok) { toast.success(`تم ${verb} ${r.count ?? 0} إذن`); setSel(new Set()); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التنفيذ");
    });

  return (
    <div className="space-y-3">
      {canManage && sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{sel.size.toLocaleString("ar-EG-u-nu-latn")} محدّد</span>
          <div className="ms-auto flex gap-2">
            {hasDraft && <Button size="sm" disabled={pending} onClick={() => run("confirm", "تأكيد")}><Icon name="Check" className="size-4" />تأكيد</Button>}
            {hasReceived && <Button size="sm" variant="outline" disabled={pending} onClick={() => run("bill", "تحويل")}><Icon name="FileText" className="size-4" />تحويل لفاتورة</Button>}
            {hasDraft && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("delete", "حذف")}><Icon name="Trash2" className="size-4 text-destructive" />حذف</Button>}
          </div>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {canManage && <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="تحديد الكل" /></TableHead>}
            <TableHead className="text-start">الرقم</TableHead>
            <TableHead className="text-start">التاريخ</TableHead>
            <TableHead className="text-start">المورد</TableHead>
            <TableHead className="text-start">أمر الشراء</TableHead>
            <TableHead className="text-start">الفاتورة</TableHead>
            <TableHead className="text-start">الحالة</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const st = STATUS[r.status] ?? { label: r.status, variant: "secondary" as const };
            return (
              <TableRow key={r.id} data-state={sel.has(r.id) ? "selected" : undefined}>
                {canManage && <TableCell>{r.status === "INVOICED" ? null : <Checkbox checked={sel.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label="تحديد" />}</TableCell>}
                <TableCell>
                  <Link href={`/erp/purchases/receipts/${encodeURIComponent(r.number)}`} className="hover:text-primary">{r.number}</Link>
                </TableCell>
                <TableCell>{dt(r.date)}</TableCell>
                <TableCell>{r.supplier ?? "—"}</TableCell>
                <TableCell>{r.order ?? "—"}</TableCell>
                <TableCell>{r.invoice ?? "—"}</TableCell>
                <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
