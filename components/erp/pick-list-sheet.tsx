"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { BarcodeScan } from "@/components/erp/barcode-scan";
import { confirm } from "@/components/erp/confirm";
import { savePickedAction, confirmReadyAction, cancelPickListAction } from "@/app/actions/erp/pick-lists";
import { cn } from "@/lib/utils";

export type SheetGroup = { itemId: string; code: string; name: string; binCode: string | null; required: number; picked: number };
export type SheetDelivery = { id: string; number: string; status: string; ready: boolean };

const q = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

/**
 * The picker's sheet: one row per item in walking order, a scanner that counts as you
 * pick, and «تأكيد الأذون الجاهزة» to ship every delivery that is complete. Prints clean
 * (the controls hide) for a paper round.
 */
export function PickListSheet({ pickListId, open, groups, deliveries, canConfirm, canCancel }: {
  pickListId: string; open: boolean; groups: SheetGroup[]; deliveries: SheetDelivery[]; canConfirm: boolean; canCancel: boolean;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, number>>(() => Object.fromEntries(groups.map((g) => [g.itemId, g.picked])));
  const [pending, start] = useTransition();

  const total = groups.reduce((s, g) => s + g.required, 0);
  const done = groups.reduce((s, g) => s + Math.min(g.required, picked[g.itemId] ?? 0), 0);
  const payload = () => groups.map((g) => ({ itemId: g.itemId, qty: picked[g.itemId] ?? 0 }));

  const onScan = (item: { id: string }) => {
    const g = groups.find((x) => x.itemId === item.id);
    if (!g) { toast.error("الصنف ده مش في الجولة"); return; }
    const next = (picked[g.itemId] ?? 0) + 1;
    if (next > g.required) toast.warning(`${g.code}: كده أكتر من المطلوب (${q(g.required)})`);
    setPicked((p) => ({ ...p, [g.itemId]: next }));
  };

  const save = () => start(async () => {
    const r = await savePickedAction(pickListId, payload());
    if (r.error) toast.error(r.error); else { toast.success("اتحفظ"); router.refresh(); }
  });

  const ship = () => void (async () => {
    if (!(await confirm({ title: "تأكيد الأذون اللي اتجهّزت كلها؟", description: "كل إذن متجهّز بالكامل هيتأكد ويخصم من المخزون — والناقص يفضل مسودة." }))) return;
    start(async () => {
      const s = await savePickedAction(pickListId, payload());
      if (s.error) { toast.error(s.error); return; }
      const r = await confirmReadyAction(pickListId);
      if (r.error) { toast.error(r.error); return; }
      toast.success(`اتأكد ${q(r.confirmed ?? 0)} إذن${r.waiting ? ` · ${q(r.waiting)} لسه ناقص` : ""}`);
      for (const f of r.failed ?? []) toast.error(f);
      router.refresh();
    });
  })();

  const cancel = () => void (async () => {
    if (!(await confirm({ title: "إلغاء الجولة؟", description: "الأذون هتفضل مسودة وتقدر تحطها في جولة تانية.", danger: true }))) return;
    start(async () => {
      const r = await cancelPickListAction(pickListId);
      if (r.error) toast.error(r.error); else { toast.success("اتلغت"); router.refresh(); }
    });
  })();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        {open && <div className="w-72"><BarcodeScan onScan={onScan} /></div>}
        <div className="flex items-center gap-2 text-sm">
          <div className="h-2 w-40 overflow-hidden rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          <span className="tabular-nums text-muted-foreground">{q(done)} من {q(total)}</span>
        </div>
        <div className="ms-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}><Icon name="Printer" className="size-4" />طباعة</Button>
          {open && <Button variant="outline" size="sm" disabled={pending} onClick={save}>حفظ</Button>}
          {open && canConfirm && (
            <Button size="sm" disabled={pending} onClick={ship}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Icon name="Truck" className="size-4" />}تأكيد الأذون الجاهزة
            </Button>
          )}
          {open && canCancel && <Button variant="ghost" size="sm" disabled={pending} onClick={cancel}>إلغاء الجولة</Button>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-start">الموقع</TableHead>
              <TableHead className="text-start">الصنف</TableHead>
              <TableHead className="text-start">المطلوب</TableHead>
              <TableHead className="text-start">اتجهّز</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => {
              const have = picked[g.itemId] ?? 0;
              const full = have + 1e-9 >= g.required;
              return (
                <TableRow key={g.itemId} className={cn(full && "bg-emerald-50/60 dark:bg-emerald-950/20")}>
                  <TableCell className="font-mono text-sm font-semibold">{g.binCode ?? "—"}</TableCell>
                  <TableCell className="max-w-[320px] whitespace-normal">
                    <div className="font-mono text-xs text-muted-foreground">{g.code}</div>
                    <div className="line-clamp-2 leading-snug">{g.name}</div>
                  </TableCell>
                  <TableCell className="text-lg font-bold tabular-nums">{q(g.required)}</TableCell>
                  <TableCell className="w-32">
                    {open ? (
                      <Input type="number" min="0" step="any" className="w-24 tabular-nums" value={String(have)}
                        onChange={(e) => setPicked((p) => ({ ...p, [g.itemId]: Math.max(0, Number(e.target.value) || 0) }))} />
                    ) : <span className="tabular-nums">{q(have)}</span>}
                  </TableCell>
                  <TableCell>
                    {full
                      ? <Icon name="CheckCircle2" className="size-5 text-emerald-600" />
                      : have > 0 ? <Icon name="CircleDashed" className="size-5 text-amber-500" /> : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <span className="text-muted-foreground">الأذون:</span>
        {deliveries.map((d) => (
          <Badge key={d.id} variant="outline" className={cn("gap-1 font-mono",
            d.status !== "DRAFT" ? "border-emerald-300 text-emerald-700 dark:text-emerald-400" : d.ready ? "border-primary/50 text-primary" : "")}>
            {d.number} · {d.status !== "DRAFT" ? "اتسلّم" : d.ready ? "جاهز" : "ناقص"}
          </Badge>
        ))}
      </div>
    </div>
  );
}
