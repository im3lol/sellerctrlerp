"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { updateStockAdjustmentAction } from "@/app/actions/erp/stock-adjustments";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Editable جرد table for a DRAFT adjustment: the operator sees the live system
// balance per warehouse, enters the physically-counted quantity (and optionally
// an intake cost for surpluses); the delta/value re-estimate live. Saving keeps
// the document DRAFT — nothing posts until تأكيد.

export type EditorLine = {
  lineId: string;
  itemCode: string | null;
  itemName: string | null;
  warehouse: string | null;
  onHand: number;   // live system balance in the line's warehouse
  avgCost: number;  // current WAC (fallback cost estimate)
  actual: number;   // counted qty (defaults to the stored target)
  unitCost: number | null;
};

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

export function AdjustmentLinesEditor({ adjId, lines }: { adjId: string; lines: EditorLine[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [edits, setEdits] = useState<Record<string, { actual: string; unitCost: string }>>(
    () => Object.fromEntries(lines.map((l) => [l.lineId, { actual: String(l.actual), unitCost: l.unitCost != null ? String(l.unitCost) : "" }])),
  );

  const rows = useMemo(() => lines.map((l) => {
    const e = edits[l.lineId];
    const actual = Number(e?.actual);
    const valid = Number.isFinite(actual) && actual >= 0;
    const delta = valid ? actual - l.onHand : 0;
    const cost = Number(e?.unitCost) > 0 ? Number(e!.unitCost) : l.avgCost;
    const value = valid ? Math.abs(delta) * cost : 0;
    return { ...l, actual, valid, delta, value };
  }), [lines, edits]);

  const total = rows.reduce((s, r) => s + r.value, 0);
  const hasInvalid = rows.some((r) => !r.valid);

  const save = () => start(async () => {
    const r = await updateStockAdjustmentAction(adjId, {
      lines: rows.map((x) => ({ lineId: x.lineId, actual: x.actual, unitCost: Number(edits[x.lineId]?.unitCost) > 0 ? Number(edits[x.lineId].unitCost) : undefined })),
    });
    if (r.ok) { toast.success("تم حفظ الكميات — التسوية ما زالت مسودة حتى التأكيد"); router.refresh(); }
    else toast.error(r.error ?? "تعذّر الحفظ");
  });

  const inputCls = "h-8 w-24 rounded-md border bg-background px-2 text-sm tabular-nums";

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-start">الصنف</TableHead>
            <TableHead className="text-start">المخزن</TableHead>
            <TableHead className="text-start" title="الرصيد الحالي بالنظام في هذا المخزن">الكمية بالنظام</TableHead>
            <TableHead className="text-start" title="الكمية المعدودة فعليًا — عدّلها بعد الجرد">الكمية الفعلية</TableHead>
            <TableHead className="text-start">الفرق</TableHead>
            <TableHead className="text-start" title="تكلفة إدخال الزيادة — فارغ = متوسط التكلفة الحالي">التكلفة</TableHead>
            <TableHead className="text-start">القيمة التقديرية</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.lineId}>
              <TableCell className="max-w-[300px] whitespace-normal"><div className="line-clamp-2 leading-snug" title={r.itemName ?? undefined}><span className="font-mono text-xs text-muted-foreground">{r.itemCode}</span> {r.itemName}</div></TableCell>
              <TableCell>{r.warehouse ?? "—"}</TableCell>
              <TableCell className="tabular-nums text-muted-foreground">{qf(r.onHand)}</TableCell>
              <TableCell>
                <input
                  type="number" min="0" step="any" dir="ltr"
                  className={`${inputCls} ${!r.valid ? "border-destructive" : ""}`}
                  value={edits[r.lineId]?.actual ?? ""}
                  onChange={(e) => setEdits((s) => ({ ...s, [r.lineId]: { ...s[r.lineId], actual: e.target.value } }))}
                />
              </TableCell>
              <TableCell className={`tabular-nums font-medium ${r.delta < 0 ? "text-destructive" : r.delta > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                {r.valid ? `${r.delta > 0 ? "+" : ""}${qf(r.delta)}` : "—"}
              </TableCell>
              <TableCell>
                <input
                  type="number" min="0" step="any" dir="ltr"
                  className={inputCls}
                  placeholder={fmt(r.avgCost)}
                  value={edits[r.lineId]?.unitCost ?? ""}
                  onChange={(e) => setEdits((s) => ({ ...s, [r.lineId]: { ...s[r.lineId], unitCost: e.target.value } }))}
                />
              </TableCell>
              <TableCell className="tabular-nums">{fmt(r.value)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow className="font-bold">
            <TableCell colSpan={6}>الإجمالي التقديري</TableCell>
            <TableCell className="tabular-nums">{fmt(total)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground">التعديلات لا تُرحّل — التسوية تظل مسودة حتى الضغط على «تأكيد».</span>
        <Button onClick={save} disabled={pending || hasInvalid}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}حفظ الكميات
        </Button>
      </div>
    </div>
  );
}
