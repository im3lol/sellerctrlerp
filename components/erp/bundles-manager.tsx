"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, Boxes, Hammer } from "lucide-react";
import { setBundleComponentsAction, deleteBundleAction, assembleAction, bulkDeleteBundlesAction } from "@/app/actions/erp/bundles";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ItemPicker } from "@/components/erp/item-picker";
import { useSelection, BulkDeleteBar, SelectBox } from "@/components/erp/bulk-select";
import { selectCls } from "@/lib/utils";

type Wh = { id: string; name: string };
type Comp = { id: string; name: string | null; code: string | null; quantity: number };
export type Bundle = { parentItemId: string; name: string; code: string | null; components: Comp[] };
type Assembly = { number: string; date: string; quantity: number; totalCost: number; kit: string; warehouse: string };

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type BomRow = { componentItemId: string; componentLabel: string; quantity: string };
const label = (code: string | null, name: string | null) => `${code ?? ""} — ${name ?? ""}`;

function BomDialog({ bundle, onClose }: { bundle: Bundle | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [parentItemId, setParentItemId] = useState(bundle?.parentItemId ?? "");
  const [parentLabel, setParentLabel] = useState(bundle ? label(bundle.code, bundle.name) : "");
  const [rows, setRows] = useState<BomRow[]>(
    bundle
      ? bundle.components.map((c) => ({ componentItemId: c.id, componentLabel: label(c.code, c.name), quantity: String(c.quantity) }))
      : [{ componentItemId: "", componentLabel: "", quantity: "1" }],
  );

  const setRow = (i: number, patch: Partial<BomRow>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { componentItemId: "", componentLabel: "", quantity: "1" }]);
  const removeRow = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs));

  const save = () => start(async () => {
    const components = rows.filter((r) => r.componentItemId && Number(r.quantity) > 0).map((r) => ({ componentItemId: r.componentItemId, quantity: Number(r.quantity) }));
    if (!parentItemId) { toast.error("اختر صنف الحزمة"); return; }
    if (components.length === 0) { toast.error("أضف مكوّناً واحداً على الأقل"); return; }
    const r = await setBundleComponentsAction({ parentItemId, components });
    if (r.ok) { toast.success("تم حفظ مكوّنات الحزمة"); onClose(); router.refresh(); }
    else toast.error(r.error ?? "تعذّر الحفظ");
  });

  return (
    <DialogContent dir="rtl" className="max-w-lg">
      <DialogHeader><DialogTitle>{bundle ? "تعديل مكوّنات الحزمة" : "حزمة جديدة"}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>صنف الحزمة (المنتج النهائي)</Label>
          {bundle ? (
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{bundle.code} — {bundle.name}</div>
          ) : (
            <ItemPicker selectedLabel={parentLabel} placeholder="ابحث بالاسم أو أي كود…"
              onSelect={(it) => { setParentItemId(it.id); setParentLabel(label(it.code, it.name)); }} />
          )}
        </div>
        <div className="space-y-2">
          <Label>المكوّنات</Label>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex-1">
                <ItemPicker
                  selectedLabel={r.componentLabel}
                  placeholder="ابحث بالاسم أو أي كود…"
                  onSelect={(it) => {
                    // A kit cannot contain itself; the picker searches every item, so the
                    // rule is enforced here rather than by filtering the list.
                    if (it.id === parentItemId) { toast.error("لا يمكن أن تكون الحزمة مكوّناً في نفسها"); return; }
                    setRow(i, { componentItemId: it.id, componentLabel: label(it.code, it.name) });
                  }}
                />
              </div>
              <Input type="number" step="1" min="1" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value.replace(/[^\d]/g, "") })} className="w-24" placeholder="كمية" />
              <Button variant="ghost" size="icon" onClick={() => removeRow(i)} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addRow}><Plus className="size-4" />إضافة مكوّن</Button>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function AssembleDialog({ bundle, warehouses, onClose }: { bundle: Bundle; warehouses: Wh[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const go = () => start(async () => {
    const r = await assembleAction({ kitItemId: bundle.parentItemId, warehouseId, quantity: Number(quantity), date });
    if (r.ok) { toast.success(`تم تجميع ${quantity} وحدة من «${bundle.name}»`); onClose(); router.refresh(); }
    else toast.error(r.error ?? "تعذّر التجميع");
  });

  return (
    <DialogContent dir="rtl">
      <DialogHeader><DialogTitle>تجميع حزمة «{bundle.name}»</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">سيتم خصم المكوّنات من المستودع وإنتاج الحزمة كمخزون قابل للبيع بتكلفة مكوّناتها.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>الكمية المراد تجميعها</Label><Input type="number" step="1" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ""))} /></div>
          <div className="space-y-1.5"><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5">
          <Label>المستودع</Label>
          <select className={selectCls} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="mb-1 font-medium">لكل وحدة حزمة يُستهلك:</div>
          <ul className="space-y-0.5 text-muted-foreground">
            {bundle.components.map((c) => <li key={c.id}>• {c.name} × {c.quantity}</li>)}
          </ul>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button onClick={go} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}<Hammer className="size-4" />تجميع</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function BundlesManager({ bundles, warehouses, assemblies, canManage }: { bundles: Bundle[]; warehouses: Wh[]; assemblies: Assembly[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [bom, setBom] = useState<{ open: boolean; bundle: Bundle | null }>({ open: false, bundle: null });
  const [assemble, setAssemble] = useState<Bundle | null>(null);
  const [confirmDel, setConfirmDel] = useState<Bundle | null>(null);
  const sel = useSelection();
  const allIds = bundles.map((b) => b.parentItemId);

  const del = (b: Bundle) => start(async () => { const r = await deleteBundleAction(b.parentItemId); if (r.ok) { toast.success("تم حذف الحزمة"); setConfirmDel(null); router.refresh(); } else toast.error(r.error ?? ""); });

  return (
    <>
      {canManage && <BulkDeleteBar ids={sel.ids} action={bulkDeleteBundlesAction} onDone={sel.clear} entity="حزمة" />}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between p-4">
            <span className="text-sm text-muted-foreground">{bundles.length} حزمة معرّفة</span>
            {canManage && <Button size="sm" onClick={() => setBom({ open: true, bundle: null })}><Plus className="size-4" />حزمة جديدة</Button>}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                {canManage && <TableHead className="w-10"><SelectBox label="تحديد الكل" checked={sel.allOf(allIds)} indeterminate={sel.someOf(allIds)} onChange={() => sel.togglePage(allIds)} /></TableHead>}
                <TableHead className="text-start">الحزمة</TableHead>
                <TableHead className="text-start">المكوّنات</TableHead>
                {canManage && <TableHead className="text-start">إجراءات</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {bundles.length === 0 ? (
                <TableRow><TableCell colSpan={canManage ? 4 : 2} className="py-10 text-center text-muted-foreground">لا توجد حزم — عرّف أول حزمة بمكوّناتها.</TableCell></TableRow>
              ) : bundles.map((b) => (
                <TableRow key={b.parentItemId} data-state={sel.has(b.parentItemId) ? "selected" : undefined}>
                  {canManage && <TableCell><SelectBox label="تحديد" checked={sel.has(b.parentItemId)} onChange={() => sel.toggle(b.parentItemId)} /></TableCell>}
                  <TableCell className="max-w-[320px] whitespace-normal font-medium"><div className="line-clamp-2 leading-snug" title={b.name}><span className="font-mono text-xs text-muted-foreground">{b.code}</span> {b.name}</div></TableCell>
                  <TableCell><div className="flex flex-wrap gap-1">{b.components.map((c) => <Badge key={c.id} variant="secondary" className="font-normal">{c.name} ×{c.quantity}</Badge>)}</div></TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => setAssemble(b)}><Hammer className="size-4" />تجميع</Button>
                        <Button size="icon" variant="ghost" onClick={() => setBom({ open: true, bundle: b })} aria-label="تعديل"><Pencil className="size-4" /></Button>
                        <Button size="icon" variant="ghost" disabled={pending} onClick={() => setConfirmDel(b)} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Boxes className="size-4" />آخر عمليات التجميع</CardTitle><CardDescription>خصم المكوّنات وإنتاج الحزمة (صفري الأثر على المحاسبة).</CardDescription></CardHeader>
        <CardContent className="p-0">
          {assemblies.length === 0 ? (
            <div className="px-4 pb-6 text-sm text-muted-foreground">لا توجد عمليات تجميع بعد.</div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead className="text-start">الرقم</TableHead><TableHead className="text-start">التاريخ</TableHead><TableHead className="text-start">الحزمة</TableHead><TableHead className="text-start">المستودع</TableHead><TableHead className="text-end">الكمية</TableHead><TableHead className="text-end">التكلفة</TableHead></TableRow></TableHeader>
              <TableBody>
                {assemblies.map((a) => (
                  <TableRow key={a.number}>
                    <TableCell className="font-mono">{a.number}</TableCell>
                    <TableCell>{a.date}</TableCell>
                    <TableCell>{a.kit}</TableCell>
                    <TableCell>{a.warehouse}</TableCell>
                    <TableCell className="text-end tabular-nums">{a.quantity.toLocaleString("ar-EG-u-nu-latn")}</TableCell>
                    <TableCell className="text-end tabular-nums">{fmt(a.totalCost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={bom.open} onOpenChange={(o) => !o && setBom({ open: false, bundle: null })}>
        {bom.open && <BomDialog bundle={bom.bundle} onClose={() => setBom({ open: false, bundle: null })} />}
      </Dialog>
      <Dialog open={!!assemble} onOpenChange={(o) => !o && setAssemble(null)}>
        {assemble && <AssembleDialog bundle={assemble} warehouses={warehouses} onClose={() => setAssemble(null)} />}
      </Dialog>
      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        {confirmDel && (
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>حذف حزمة «{confirmDel.name}»؟</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">سيُحذف تعريف المكوّنات فقط؛ عمليات التجميع السابقة ومخزونها لا تتأثر.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDel(null)}>إلغاء</Button>
              <Button variant="destructive" disabled={pending} onClick={() => del(confirmDel)}>حذف</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
