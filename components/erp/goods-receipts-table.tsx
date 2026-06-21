"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { bulkConvertReceiptsAction } from "@/app/actions/erp/goods-receipts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";

const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

type Row = { id: string; number: string; date: Date; supplier: string | null; order: string | null; invoice: string | null; invoiced: boolean };

export function GoodsReceiptsTable({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());

  // Only un-invoiced receipts can be billed in bulk.
  const billable = rows.filter((r) => !r.invoiced).map((r) => r.id);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = billable.length > 0 && billable.every((id) => sel.has(id));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(billable));

  const bill = () =>
    start(async () => {
      const r = await bulkConvertReceiptsAction([...sel]);
      if (r.ok) { toast.success(`تم تحويل ${r.count ?? 0} إذن إلى فاتورة`); setSel(new Set()); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التحويل");
    });

  return (
    <div className="space-y-3">
      {canManage && sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{sel.size.toLocaleString("ar-EG-u-nu-latn")} محدّد</span>
          <div className="ms-auto flex gap-2">
            <Button size="sm" disabled={pending} onClick={bill}><Icon name="FileText" className="size-4" />تحويل لفاتورة</Button>
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
          {rows.map((r) => (
            <TableRow key={r.id} data-state={sel.has(r.id) ? "selected" : undefined}>
              {canManage && <TableCell>{r.invoiced ? null : <Checkbox checked={sel.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label="تحديد" />}</TableCell>}
              <TableCell>
                <Link href={`/erp/purchases/receipts/${encodeURIComponent(r.number)}`} className="hover:text-primary">{r.number}</Link>
              </TableCell>
              <TableCell>{dt(r.date)}</TableCell>
              <TableCell>{r.supplier ?? "—"}</TableCell>
              <TableCell>{r.order ?? "—"}</TableCell>
              <TableCell>{r.invoice ?? "—"}</TableCell>
              <TableCell><Badge variant={r.invoiced ? "default" : "secondary"}>{r.invoiced ? "مفوتر" : "تم الاستلام"}</Badge></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
