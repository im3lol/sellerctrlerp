"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { bulkReceiptsAction } from "@/app/actions/erp/goods-receipts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";

const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const qf = (v: number) => v.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  RECEIVED: { label: "تم الاستلام", variant: "default" },
  INVOICED: { label: "مفوتر", variant: "default" },
  REVERSED: { label: "مرتجع", variant: "destructive" },
};
const DONE = new Set(["INVOICED", "REVERSED"]);

type ReturnRow = { id: string; number: string; date: Date; qty: number; status: string };
type Row = { id: string; number: string; date: Date; supplier: string | null; order: string | null; invoice: string | null; status: string; returned?: boolean; returns?: ReturnRow[] };

export function GoodsReceiptsTable({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());

  // DRAFT → confirm/delete; RECEIVED → bill. INVOICED → nothing to do.
  const eligible = rows.filter((r) => !DONE.has(r.status)).map((r) => r.id);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = eligible.length > 0 && eligible.every((id) => sel.has(id));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(eligible));

  const selRows = rows.filter((r) => sel.has(r.id));
  const hasDraft = selRows.some((r) => r.status === "DRAFT");
  const hasReceived = selRows.some((r) => r.status === "RECEIVED");

  const run = (op: "confirm" | "bill" | "delete", verb: string) => {
    void (async () => {
      if (!(await confirm({ title: `${verb} ${sel.size} إذن`, danger: op === "delete" }))) return;
      start(async () => {
        const r = await bulkReceiptsAction(op, [...sel]);
        if (r.ok) { toast.success(`تم ${verb} ${r.count ?? 0} إذن`); setSel(new Set()); router.refresh(); }
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
              <Fragment key={r.id}>
                <TableRow data-state={sel.has(r.id) ? "selected" : undefined}>
                  {canManage && <TableCell>{DONE.has(r.status) ? null : <Checkbox checked={sel.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label="تحديد" />}</TableCell>}
                  <TableCell>
                    <Link href={`/erp/purchases/receipts/${encodeURIComponent(r.number)}`} className="hover:text-primary">{r.number}</Link>
                  </TableCell>
                  <TableCell>{dt(r.date)}</TableCell>
                  <TableCell>{r.supplier ?? "—"}</TableCell>
                  <TableCell>{r.order ?? "—"}</TableCell>
                  <TableCell>{r.invoice ?? "—"}</TableCell>
                  <TableCell><div className="flex items-center gap-1"><Badge variant={st.variant}>{st.label}</Badge>{r.returned && <Badge variant="destructive">مرتجع</Badge>}</div></TableCell>
                </TableRow>
                {r.returns?.map((rt) => (
                  <TableRow key={rt.id} className="bg-destructive/5">
                    {canManage && <TableCell />}
                    <TableCell className="ps-8">
                      <Link href={`/erp/purchases/returns/${encodeURIComponent(rt.number)}`} className="flex items-center gap-1 text-muted-foreground hover:text-primary"><Icon name="Undo2" className="size-3.5" />{rt.number}</Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{dt(rt.date)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.supplier ?? "—"}</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell className="text-destructive">كمية مرتجعة: {qf(rt.qty)}</TableCell>
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
