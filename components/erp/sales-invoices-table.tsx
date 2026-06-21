"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { bulkSalesInvoicesAction } from "@/app/actions/erp/sales-invoices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";

const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  POSTED: { label: "مرحّلة", variant: "default" },
  PARTIAL_PAID: { label: "مدفوعة جزئياً", variant: "secondary" },
  PAID: { label: "مدفوعة", variant: "default" },
  CANCELLED: { label: "ملغاة", variant: "destructive" },
};

type Row = { id: string; number: string; date: Date; customer: string | null; total: string | null; balanceDue: string | null; status: string; returned?: boolean };

export function SalesInvoicesTable({ rows, canManage, canPost }: { rows: Row[]; canManage: boolean; canPost: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());

  const eligible = rows.filter((r) => r.status === "DRAFT").map((r) => r.id);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = eligible.length > 0 && eligible.every((id) => sel.has(id));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(eligible));
  const actionable = canManage && eligible.length > 0;

  const run = (op: "post" | "delete", verb: string) =>
    start(async () => {
      const r = await bulkSalesInvoicesAction(op, [...sel]);
      if (r.ok) { toast.success(`تم ${verb} ${r.count ?? 0} فاتورة`); setSel(new Set()); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التنفيذ");
    });

  return (
    <div className="space-y-3">
      {actionable && sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{sel.size.toLocaleString("ar-EG-u-nu-latn")} محدّد</span>
          <div className="ms-auto flex gap-2">
            {canPost && <Button size="sm" disabled={pending} onClick={() => run("post", "تأكيد")}><Icon name="Check" className="size-4" />تأكيد</Button>}
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("delete", "حذف")}><Icon name="Trash2" className="size-4 text-destructive" />حذف</Button>
          </div>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {actionable && <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="تحديد الكل" /></TableHead>}
            <TableHead className="text-start">الرقم</TableHead>
            <TableHead className="text-start">التاريخ</TableHead>
            <TableHead className="text-start">العميل</TableHead>
            <TableHead className="text-start">الإجمالي</TableHead>
            <TableHead className="text-start">المتبقّي</TableHead>
            <TableHead className="text-start">الحالة</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const st = STATUS[r.status] ?? { label: r.status, variant: "secondary" as const };
            return (
              <TableRow key={r.id} data-state={sel.has(r.id) ? "selected" : undefined}>
                {actionable && <TableCell>{r.status === "DRAFT" ? <Checkbox checked={sel.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label="تحديد" /> : null}</TableCell>}
                <TableCell>
                  <Link href={`/erp/sales/invoices/${encodeURIComponent(r.number)}`} className="hover:text-primary">{r.number}</Link>
                </TableCell>
                <TableCell>{dt(r.date)}</TableCell>
                <TableCell>{r.customer ?? "—"}</TableCell>
                <TableCell>{fmt(r.total)}</TableCell>
                <TableCell>{fmt(r.balanceDue)}</TableCell>
                <TableCell><div className="flex items-center gap-1"><Badge variant={st.variant}>{st.label}</Badge>{r.returned && <Badge variant="destructive">مرتجع</Badge>}</div></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
