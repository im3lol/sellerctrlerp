"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { bulkSalesOrdersAction } from "@/app/actions/erp/sales-orders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";

const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  CONFIRMED: { label: "مؤكّد", variant: "default" },
  PARTIALLY_DELIVERED: { label: "تسليم جزئي", variant: "secondary" },
  DELIVERED: { label: "تم التسليم", variant: "default" },
  INVOICED: { label: "مفوتر", variant: "default" },
  CANCELLED: { label: "ملغى", variant: "destructive" },
};

type ReturnRow = { id: string; number: string; date: Date; qty: number; status: string };
type Row = { id: string; number: string; date: Date; total: string | null; status: string; customer: string | null; orderedQty: number; deliveredQty: number; returned?: boolean; returns?: ReturnRow[] };

const DELIVERING = new Set(["CONFIRMED", "PARTIALLY_DELIVERED", "DELIVERED", "INVOICED"]);

export function SalesOrdersTable({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ids = rows.map((r) => r.id);
  const allSelected = ids.length > 0 && ids.every((id) => sel.has(id));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(ids));

  const bulk = (op: "confirm" | "cancel" | "delete") => {
    const verb = op === "confirm" ? "تأكيد" : op === "cancel" ? "إلغاء" : "حذف";
    void (async () => {
      if (!(await confirm({ title: `${verb} ${sel.size} أمر`, danger: op !== "confirm" }))) return;
      start(async () => {
        const r = await bulkSalesOrdersAction(op, [...sel]);
        if (r.ok) { toast.success(`تم ${verb} ${r.count ?? 0} أمر`); setSel(new Set()); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التنفيذ");
      });
    })();
  };

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
            <TableHead className="text-start">العميل</TableHead>
            <TableHead className="text-start">الإجمالي</TableHead>
            <TableHead className="text-start">الحالة</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const st = STATUS[r.status] ?? { label: r.status, variant: "secondary" as const };
            const pct = r.orderedQty > 0 ? Math.min(100, Math.round((r.deliveredQty / r.orderedQty) * 100)) : 0;
            const showBar = DELIVERING.has(r.status);
            const full = pct >= 100;
            return (
              <Fragment key={r.id}>
                <TableRow data-state={sel.has(r.id) ? "selected" : undefined}>
                  {canManage && <TableCell><Checkbox checked={sel.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label="تحديد" /></TableCell>}
                  <TableCell>
                    <Link href={`/erp/sales/orders/${encodeURIComponent(r.number)}`} className="hover:text-primary">{r.number}</Link>
                  </TableCell>
                  <TableCell>{dt(r.date)}</TableCell>
                  <TableCell>{r.customer ?? "—"}</TableCell>
                  <TableCell>{fmt(r.total)}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1"><Badge variant={st.variant}>{st.label}</Badge>{r.returned && <Badge variant="destructive">مرتجع</Badge>}</div>
                      {showBar && (
                        <div className="flex items-center gap-2">
                          <div className="h-1 w-20 overflow-hidden rounded-full bg-muted">
                            <div className={`h-full rounded-full ${full ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: pct === 0 ? "0%" : `${Math.max(pct, 4)}%` }} />
                          </div>
                          <span className="text-[11px] tabular-nums text-muted-foreground">{qty(r.deliveredQty)}/{qty(r.orderedQty)}</span>
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {r.returns?.map((rt) => (
                  <TableRow key={rt.id} className="bg-destructive/5">
                    {canManage && <TableCell />}
                    <TableCell className="ps-8">
                      <Link href={`/erp/sales/returns/${encodeURIComponent(rt.number)}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"><Icon name="Undo2" className="size-3.5" />{rt.number}</Link>
                      <span className="ms-2 text-destructive">كمية مرتجعة: {qty(rt.qty)}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{dt(rt.date)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.customer ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell><Badge variant="destructive">{rt.status === "POSTED" ? "مرتجع" : "مرتجع (مسودة)"}</Badge></TableCell>
                  </TableRow>
                ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
