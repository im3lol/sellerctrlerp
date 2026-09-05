"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { bulkSalesInvoicesAction, type SalesInvoicesFilter } from "@/app/actions/erp/sales-invoices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { SalesInvoiceRowMenu } from "@/components/erp/sales-invoice-row-menu";

const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  POSTED: { label: "مرحّلة", variant: "default" },
  PARTIAL_PAID: { label: "مدفوعة جزئياً", variant: "secondary" },
  PAID: { label: "مدفوعة", variant: "default" },
  CANCELLED: { label: "ملغاة", variant: "destructive" },
};

type ReturnRow = { id: string; number: string; date: Date; total: string | null; status: string };
type Row = { id: string; number: string; date: Date; customer: string | null; order?: string | null; total: string | null; balanceDue: string | null; status: string; returned?: boolean; returns?: ReturnRow[] };

export function SalesInvoicesTable({ rows, canCreate, canPost, canCollect, total, filter }: { rows: Row[]; canCreate: boolean; canPost: boolean; canCollect: boolean; total: number; filter: SalesInvoicesFilter }) {
  const canAct = canPost || canCreate || canCollect;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [allPages, setAllPages] = useState(false);
  const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

  // Every invoice is selectable — post/delete skip ineligible rows server-side.
  const pageIds = rows.map((r) => r.id);
  const toggle = (id: string) => { setAllPages(false); setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const allSelected = allPages || (pageIds.length > 0 && pageIds.every((id) => sel.has(id)));
  const toggleAll = () => { setAllPages(false); setSel(allSelected ? new Set() : new Set(pageIds)); };
  const count = allPages ? total : sel.size;
  const actionable = canAct;

  const run = (op: "post" | "delete" | "collect", verb: string) => {
    void (async () => {
      if (!(await confirm({ title: `${verb} ${int(count)} فاتورة`, danger: op === "delete" }))) return;
      start(async () => {
        const r = await bulkSalesInvoicesAction(op, allPages ? [] : [...sel], allPages ? filter : undefined);
        if (r.ok) { toast.success(`تم ${verb} ${int(r.count ?? 0)} فاتورة`); setSel(new Set()); setAllPages(false); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التنفيذ");
      });
    })();
  };

  return (
    <div className="space-y-3">
      {actionable && count > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{allPages ? `كل الـ${int(total)} محدّد` : `${int(sel.size)} محدّد`}</span>
          {!allPages && allSelected && total > pageIds.length && (
            <button type="button" className="text-primary underline" onClick={() => setAllPages(true)}>حدّد الكل ({int(total)}) في كل الصفحات</button>
          )}
          {count > 0 && <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setSel(new Set()); setAllPages(false); }}>إلغاء التحديد</button>}
          <div className="ms-auto flex gap-2">
            {canPost && <Button size="sm" disabled={pending} onClick={() => run("post", "تأكيد")}><Icon name="Check" className="size-4" />تأكيد</Button>}
            {canCollect && <Button size="sm" variant="outline" disabled={pending} onClick={() => run("collect", "تحصيل")} title="ينشئ سند قبض مسودة بقيمة المتبقّي لكل فاتورة مرحّلة عليها رصيد"><Icon name="HandCoins" className="size-4" />تحصيل</Button>}
            {canCreate && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("delete", "حذف")}><Icon name="Trash2" className="size-4 text-destructive" />حذف</Button>}
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
            <TableHead className="text-start">أمر البيع</TableHead>
            <TableHead className="text-start">الإجمالي</TableHead>
            <TableHead className="text-start">المتبقّي</TableHead>
            <TableHead className="text-start">الحالة</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const st = STATUS[r.status] ?? { label: r.status, variant: "secondary" as const };
            return (
              <Fragment key={r.id}>
                <TableRow data-state={allPages || sel.has(r.id) ? "selected" : undefined}>
                  {actionable && <TableCell><Checkbox checked={allPages || sel.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label="تحديد" /></TableCell>}
                  <TableCell>
                    <Link href={`/sales/invoices/${encodeURIComponent(r.number)}`} className="hover:text-primary">{r.number}</Link>
                  </TableCell>
                  <TableCell>{dt(r.date)}</TableCell>
                  <TableCell className="max-w-[200px] truncate" title={r.customer ?? undefined}>{r.customer ?? "—"}</TableCell>
                  <TableCell>{r.order ? <Link href={`/sales/orders/${encodeURIComponent(r.order)}`} className="font-mono text-sm hover:text-primary">{r.order}</Link> : "—"}</TableCell>
                  <TableCell>{fmt(r.total)}</TableCell>
                  <TableCell>{fmt(r.balanceDue)}</TableCell>
                  <TableCell><div className="flex items-center gap-1"><Badge variant={st.variant}>{st.label}</Badge>{r.returned && <Badge variant="destructive">مرتجع</Badge>}</div></TableCell>
                  <TableCell>
                    <SalesInvoiceRowMenu id={r.id} number={r.number} status={r.status} canPost={canPost} canManage={canCreate} />
                  </TableCell>
                </TableRow>
                {r.returns?.map((rt) => (
                  <TableRow key={rt.id} className="bg-destructive/5">
                    {actionable && <TableCell />}
                    <TableCell className="ps-8">
                      <Link href={`/sales/returns/${encodeURIComponent(rt.number)}`} className="flex items-center gap-1 text-muted-foreground hover:text-primary"><Icon name="Undo2" className="size-3.5" />{rt.number}</Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{dt(rt.date)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.customer ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell className="text-destructive">−{fmt(rt.total)}</TableCell>
                    <TableCell>—</TableCell>
                    <TableCell><Badge variant="destructive">{rt.status === "POSTED" ? "مرتجع" : "مرتجع (مسودة)"}</Badge></TableCell>
                    <TableCell />
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
