"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { bulkPurchaseOrdersAction } from "@/app/actions/erp/purchase-orders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";

const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  CONFIRMED: { label: "مؤكّد", variant: "default" },
  PARTIALLY_RECEIVED: { label: "استلام جزئي", variant: "secondary" },
  RECEIVED: { label: "تم الاستلام", variant: "default" },
  INVOICED: { label: "مفوتر", variant: "default" },
  CANCELLED: { label: "ملغى", variant: "destructive" },
};

type Row = { id: string; number: string; date: Date; total: string | null; status: string; supplier: string | null };

export function PurchaseOrdersTable({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ids = rows.map((r) => r.id);
  const allSelected = ids.length > 0 && ids.every((id) => sel.has(id));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(ids));

  const bulk = (op: "confirm" | "cancel" | "delete") =>
    start(async () => {
      const r = await bulkPurchaseOrdersAction(op, [...sel]);
      if (r.ok) {
        const verb = op === "confirm" ? "تأكيد" : op === "cancel" ? "إلغاء" : "حذف";
        toast.success(`تم ${verb} ${r.count ?? 0} أمر`);
        setSel(new Set());
        router.refresh();
      } else toast.error(r.error ?? "تعذّر التنفيذ");
    });

  return (
    <div className="space-y-3">
      {canManage && sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{sel.size.toLocaleString("ar-EG-u-nu-latn")} محدّد</span>
          <div className="ms-auto flex gap-2">
            <Button size="sm" disabled={pending} onClick={() => bulk("confirm")}><Icon name="Check" className="size-4" />تأكيد</Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => bulk("cancel")}><Icon name="X" className="size-4" />إلغاء</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => bulk("delete")}><Icon name="Trash2" className="size-4 text-destructive" />حذف</Button>
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
            <TableHead className="text-start">الإجمالي</TableHead>
            <TableHead className="text-start">الحالة</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const st = STATUS[r.status] ?? { label: r.status, variant: "secondary" as const };
            return (
              <TableRow key={r.id} data-state={sel.has(r.id) ? "selected" : undefined}>
                {canManage && <TableCell><Checkbox checked={sel.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label="تحديد" /></TableCell>}
                <TableCell>
                  <Link href={`/erp/purchases/orders/${encodeURIComponent(r.number)}`} className="hover:text-primary">{r.number}</Link>
                </TableCell>
                <TableCell>{dt(r.date)}</TableCell>
                <TableCell>{r.supplier ?? "—"}</TableCell>
                <TableCell>{fmt(r.total)}</TableCell>
                <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
