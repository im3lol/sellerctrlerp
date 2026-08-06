"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { bulkSalesReturnsAction } from "@/app/actions/erp/sales-returns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";

const fmt = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const DOC_STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  POSTED: { label: "مُرحّل", variant: "default" },
  CANCELLED: { label: "ملغى", variant: "destructive" },
};
// Origin: a marketplace channel vs a hand-keyed return — so the two are never visually identical.
const ORIGIN: Record<string, string> = { AMAZON: "أمازون", NOON: "نون", SHOPIFY: "شوبيفاي" };
const unsellable = (d?: string | null) => !!d && d !== "SELLABLE";

export type ReturnRow = {
  id: string; number: string; date: Date; customer: string | null;
  channel: string | null; externalReturnId: string | null;
  reason: string | null; disposition: string | null;
  orderNumber: string | null; total: string | null; status: string;
};

export function SalesReturnsTable({ rows, canConfirm, canCreate }: { rows: ReturnRow[]; canConfirm: boolean; canCreate: boolean }) {
  const canAct = canConfirm || canCreate;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

  // Only DRAFT returns are bulk-actionable (confirm/delete); posted/cancelled aren't selectable.
  const draftIds = rows.filter((r) => r.status === "DRAFT").map((r) => r.id);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = draftIds.length > 0 && draftIds.every((id) => sel.has(id));
  const toggleAll = () => setSel(allSel ? new Set() : new Set(draftIds));

  const run = (op: "confirm" | "delete", verb: string) => {
    const ids = [...sel];
    if (ids.length === 0) return;
    void (async () => {
      if (!(await confirm({ title: `${verb} ${int(ids.length)} مرتجع`, danger: op === "delete" }))) return;
      start(async () => {
        const r = await bulkSalesReturnsAction(op, ids);
        if (r.ok) { toast.success(`تم ${verb} ${int(r.count ?? 0)} مرتجع`); setSel(new Set()); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التنفيذ");
      });
    })();
  };

  return (
    <div className="space-y-3">
      {canAct && sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{int(sel.size)} محدّد</span>
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setSel(new Set())}>إلغاء التحديد</button>
          <div className="ms-auto flex gap-2">
            {canConfirm && <Button size="sm" disabled={pending} onClick={() => run("confirm", "تأكيد")} title="يرحّل كل مرتجع محدّد حسب حالته (التالف لا يرجع مخزون قابل للبيع)"><Icon name="Check" className="size-4" />تأكيد المحدّد</Button>}
            {canCreate && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("delete", "حذف")}><Icon name="Trash2" className="size-4 text-destructive" />حذف</Button>}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {canAct && <TableHead className="w-10">{draftIds.length > 0 && <Checkbox checked={allSel} onCheckedChange={toggleAll} aria-label="تحديد كل المسودات" />}</TableHead>}
              <TableHead className="text-start">الرقم</TableHead>
              <TableHead className="text-start">التاريخ</TableHead>
              <TableHead className="text-start">العميل / المصدر</TableHead>
              <TableHead className="text-start">الأمر الأصلي</TableHead>
              <TableHead className="text-start">السبب</TableHead>
              <TableHead className="text-start">الحالة</TableHead>
              <TableHead className="text-start">القيمة</TableHead>
              <TableHead className="text-start">المستند</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                {canAct && <TableCell>{r.status === "DRAFT" && <Checkbox checked={sel.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={`تحديد ${r.number}`} />}</TableCell>}
                <TableCell>
                  <Link href={`/sales/returns/${encodeURIComponent(r.number)}`} className="text-primary hover:underline">{r.number}</Link>
                  {r.externalReturnId && <div className="font-mono text-[10px] text-muted-foreground">{r.externalReturnId}</div>}
                </TableCell>
                <TableCell className="whitespace-nowrap">{dt(r.date)}</TableCell>
                <TableCell>
                  <div>{r.customer ?? "—"}</div>
                  <Badge variant={r.channel ? "outline" : "secondary"} className="mt-0.5 text-[10px]">{r.channel ? (ORIGIN[r.channel] ?? r.channel) : "يدوي"}</Badge>
                </TableCell>
                <TableCell>{r.orderNumber ? <Link href={`/sales/orders/${encodeURIComponent(r.orderNumber)}`} className="text-primary hover:underline">{r.orderNumber}</Link> : "—"}</TableCell>
                <TableCell className="max-w-[200px]"><div className="line-clamp-2 text-sm text-muted-foreground" title={r.reason ?? undefined}>{r.reason ?? "—"}</div></TableCell>
                <TableCell>
                  {r.disposition
                    ? <Badge variant="outline" className={unsellable(r.disposition) ? "border-destructive/40 text-destructive" : "border-emerald-500/40 text-emerald-600"}>{unsellable(r.disposition) ? "تالف / غير قابل للبيع" : "قابل للبيع"}</Badge>
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="tabular-nums text-destructive">−{fmt(r.total)}</TableCell>
                <TableCell><Badge variant={DOC_STATUS[r.status]?.variant ?? "secondary"}>{DOC_STATUS[r.status]?.label ?? r.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
