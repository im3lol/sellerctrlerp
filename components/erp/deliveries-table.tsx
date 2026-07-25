"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { bulkDeliveriesAction, type DeliveriesFilter } from "@/app/actions/erp/deliveries";
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
  DELIVERED: { label: "تم التسليم", variant: "default" },
  INVOICED: { label: "مفوتر", variant: "default" },
  REVERSED: { label: "مرتجع", variant: "destructive" },
};

type ReturnRow = { id: string; number: string; date: Date; qty: number; status: string };
type Row = { id: string; number: string; date: Date; customer: string | null; order: string | null; invoice: string | null; status: string; returned?: boolean; returns?: ReturnRow[] };

export function DeliveriesTable({ rows, canManage, total, filter, shortIds = [] }: { rows: Row[]; canManage: boolean; total: number; filter: DeliveriesFilter; shortIds?: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [allPages, setAllPages] = useState(false);
  const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

  const short = new Set(shortIds);
  const pageIds = rows.map((r) => r.id);
  const toggle = (id: string) => { setAllPages(false); setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const allSelected = allPages || (pageIds.length > 0 && pageIds.every((id) => sel.has(id)));
  const toggleAll = () => { setAllPages(false); setSel(allSelected ? new Set() : new Set(pageIds)); };
  const count = allPages ? total : sel.size;

  const selRows = rows.filter((r) => sel.has(r.id));
  // In all-pages mode every op is offered — the server-side per-row guards skip
  // ineligible rows and report the real count.
  const hasDraft = allPages || selRows.some((r) => r.status === "DRAFT");
  const hasDelivered = allPages || selRows.some((r) => r.status === "DELIVERED");

  const run = (op: "confirm" | "bill" | "delete" | "reverse", verb: string) => {
    void (async () => {
      if (!(await confirm({ title: `${verb} ${int(count)} إذن`, danger: op === "delete" || op === "reverse" }))) return;
      start(async () => {
        const r = await bulkDeliveriesAction(op, allPages ? [] : [...sel], allPages ? filter : undefined);
        if (r.ok) { toast.success(`تم ${verb} ${int(r.count ?? 0)} إذن`); setSel(new Set()); setAllPages(false); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التنفيذ");
      });
    })();
  };

  return (
    <div className="space-y-3">
      {canManage && count > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{allPages ? `كل الـ${int(total)} محدّد` : `${int(sel.size)} محدّد`}</span>
          {!allPages && allSelected && total > rows.length && (
            <button type="button" className="text-primary underline" onClick={() => setAllPages(true)}>حدّد الكل ({int(total)}) في كل الصفحات</button>
          )}
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setSel(new Set()); setAllPages(false); }}>إلغاء التحديد</button>
          <div className="ms-auto flex gap-2">
            {hasDraft && <Button size="sm" disabled={pending} onClick={() => run("confirm", "تأكيد")}><Icon name="Check" className="size-4" />تأكيد</Button>}
            {hasDelivered && <Button size="sm" variant="outline" disabled={pending} onClick={() => run("bill", "تحويل")} title="ينشئ فاتورة مسودة لكل إذن مؤكّد"><Icon name="FileText" className="size-4" />تحويل لفاتورة</Button>}
            {hasDelivered && <Button size="sm" variant="outline" disabled={pending} onClick={() => run("reverse", "إلغاء")} title="عكس الصرف: يعيد البضاعة للمخزون ويعكس التكلفة"><Icon name="Undo2" className="size-4" />إلغاء</Button>}
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
            <TableHead className="text-start">العميل</TableHead>
            <TableHead className="text-start">أمر البيع</TableHead>
            <TableHead className="text-start">الفاتورة</TableHead>
            <TableHead className="text-start">الحالة</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const st = STATUS[r.status] ?? { label: r.status, variant: "secondary" as const };
            return (
              <Fragment key={r.id}>
                <TableRow data-state={allPages || sel.has(r.id) ? "selected" : undefined}>
                  {canManage && <TableCell><Checkbox checked={allPages || sel.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label="تحديد" /></TableCell>}
                  <TableCell>
                    <Link href={`/sales/deliveries/${encodeURIComponent(r.number)}`} className="hover:text-primary">{r.number}</Link>
                  </TableCell>
                  <TableCell>{dt(r.date)}</TableCell>
                  <TableCell className="max-w-[200px] truncate" title={r.customer ?? undefined}>{r.customer ?? "—"}</TableCell>
                  <TableCell>{r.order ?? "—"}</TableCell>
                  <TableCell>{r.invoice ?? "—"}</TableCell>
                  <TableCell><div className="flex items-center gap-1"><Badge variant={st.variant}>{st.label}</Badge>{r.status === "DRAFT" && short.has(r.id) && <Badge variant="destructive" title="المخزون الحالي لا يغطي كميات هذا الإذن (مع باقي المسودات)">نقص مخزون</Badge>}{r.returned && <Badge variant="destructive">مرتجع</Badge>}</div></TableCell>
                </TableRow>
                {r.returns?.map((rt) => (
                  <TableRow key={rt.id} className="bg-destructive/5">
                    {canManage && <TableCell />}
                    <TableCell className="ps-8">
                      <Link href={`/sales/returns/${encodeURIComponent(rt.number)}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"><Icon name="Undo2" className="size-3.5" />{rt.number}</Link>
                      <span className="ms-2 text-destructive">كمية مرتجعة: {qf(rt.qty)}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{dt(rt.date)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.customer ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">—</TableCell>
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
