"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  listBinsAction, saveBinAction, deleteBinAction, assignItemBinAction, unassignItemBinAction,
  getItemLocationsAction, type BinRow,
} from "@/app/actions/erp/bins";
import { validateBinCode } from "@/lib/erp/bins";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { selectCls } from "@/lib/utils";

export type Option = { id: string; label: string };
type Location = NonNullable<Awaited<ReturnType<typeof getItemLocationsAction>>["locations"]>[number];

/**
 * Storage locations. A bin says where to walk — quantities stay at warehouse level, so
 * nothing on this screen can move a number in the stock ledger. Codes sort naturally
 * (A-2 before A-10), which is what turns a pick list into one pass through the aisles.
 */
export function BinsManager({ warehouses, items, canEdit }: {
  warehouses: Option[]; items: Option[]; canEdit: boolean;
}) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [bins, setBins] = useState<BinRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();

  const [form, setForm] = useState({ code: "", nameAr: "" });
  const [assign, setAssign] = useState({ itemId: "", binId: "", isPrimary: true });
  const [lookupItem, setLookupItem] = useState("");
  const [locations, setLocations] = useState<Location[] | null>(null);

  const load = () => {
    setLoading(true);
    void listBinsAction(warehouseId || undefined).then((r) => {
      setLoading(false);
      if (!r.ok) { toast.error(r.error ?? "تعذّر التحميل"); return; }
      setBins(r.bins ?? []);
    });
  };
  useEffect(() => { load(); }, [warehouseId]);

  const addBin = () => {
    if (!warehouseId) return toast.error("اختر المستودع");
    const err = validateBinCode(form.code, bins.map((b) => b.code));
    if (err) return toast.error(err);
    start(async () => {
      const r = await saveBinAction({ warehouseId, code: form.code, nameAr: form.nameAr || null, isActive: true });
      if (r.ok) { toast.success("تم إضافة الموقع"); setForm({ code: "", nameAr: "" }); load(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  const removeBin = (b: BinRow) =>
    void (async () => {
      const go = await confirm({
        danger: true, title: `حذف موقع ${b.code}؟`,
        description: b.itemCount > 0
          ? `${b.itemCount} صنف مسجّل مكانه هنا — هيرجعوا بدون موقع. مفيش أي كمية بتتأثر.`
          : "مفيش أصناف مربوطة بالموقع ده.",
        confirmText: "احذف", cancelText: "رجوع",
      });
      if (!go) return;
      start(async () => {
        const r = await deleteBinAction(b.id);
        if (r.ok) { toast.success("تم الحذف"); load(); }
        else toast.error(r.error ?? "تعذّر الحذف");
      });
    })();

  const putAway = () => {
    if (!assign.itemId || !assign.binId) return toast.error("اختر الصنف والموقع");
    start(async () => {
      const r = await assignItemBinAction(assign);
      if (r.ok) { toast.success("تم تسجيل مكان الصنف"); load(); if (lookupItem === assign.itemId) lookup(assign.itemId); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  const lookup = (itemId: string) => {
    setLookupItem(itemId);
    if (!itemId) { setLocations(null); return; }
    void getItemLocationsAction(itemId).then((r) => {
      if (!r.ok) { toast.error(r.error ?? "تعذّر البحث"); return; }
      setLocations(r.locations ?? []);
    });
  };

  const unassign = (binId: string) =>
    start(async () => {
      const r = await unassignItemBinAction(lookupItem, binId);
      if (r.ok) { toast.success("تم الإلغاء"); lookup(lookupItem); load(); }
      else toast.error(r.error ?? "تعذّر الإلغاء");
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>مواقع التخزين</CardTitle>
              <CardDescription>
                {loading ? "جارٍ التحميل…" : `${bins.length} موقع`} — مرتّبة بترتيب المشي في المخزن، فـ A-2 قبل A-10.
              </CardDescription>
            </div>
            <select className={`${selectCls} w-56`} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {canEdit && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2"><Label>الكود</Label>
                <Input className="w-36 font-mono" dir="ltr" value={form.code} placeholder="A-1-3"
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} /></div>
              <div className="min-w-48 flex-1 space-y-2"><Label>الوصف</Label>
                <Input value={form.nameAr} placeholder="ممر A · رف ١ · الرف الثالث"
                  onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))} /></div>
              <Button onClick={addBin} disabled={pending}><Icon name="Plus" className="size-4" />أضِف</Button>
            </div>
          )}

          {bins.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">
              مفيش مواقع في المستودع ده. الكود هو اللي بيرتّب المشي — استخدم نظام زي «ممر-رف-دور» (A-1-3).
            </p>
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الكود</TableHead>
                    <TableHead className="text-start">الوصف</TableHead>
                    <TableHead className="text-start">أصناف</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                    {canEdit && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bins.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono text-sm" dir="ltr">{b.code}</TableCell>
                      <TableCell className="text-muted-foreground">{b.nameAr ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{b.itemCount}</TableCell>
                      <TableCell>{b.isActive ? <Badge variant="secondary">مفعّل</Badge> : <Badge variant="outline">موقوف</Badge>}</TableCell>
                      {canEdit && (
                        <TableCell>
                          <Button size="icon" variant="ghost" aria-label="حذف" onClick={() => removeBin(b)}>
                            <Icon name="Trash2" className="size-4 text-destructive" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {canEdit && bins.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>تسجيل مكان صنف</CardTitle>
            <CardDescription>الصنف ممكن يكون في أكتر من موقع — «الأساسي» هو اللي بيتمشي عليه الأول.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-64 flex-1 space-y-2">
                <Label>الصنف</Label>
                <CellCombobox
                  selectedLabel={items.find((i) => i.id === assign.itemId)?.label ?? ""}
                  options={items} onSelect={(id) => setAssign((a) => ({ ...a, itemId: id }))}
                  placeholder="ابحث عن الصنف…"
                />
              </div>
              <div className="space-y-2">
                <Label>الموقع</Label>
                <select className={`${selectCls} w-40`} value={assign.binId}
                  onChange={(e) => setAssign((a) => ({ ...a, binId: e.target.value }))}>
                  <option value="">اختر…</option>
                  {bins.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
                </select>
              </div>
              <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
                <input type="checkbox" className="size-4 rounded border-input" checked={assign.isPrimary}
                  onChange={(e) => setAssign((a) => ({ ...a, isPrimary: e.target.checked }))} />
                أساسي
              </label>
              <Button onClick={putAway} disabled={pending}><Icon name="Check" className="size-4" />سجّل</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>الصنف ده مكانه فين؟</CardTitle>
          <CardDescription>كل المواقع اللي الصنف متسجّل فيها، الأساسي الأول.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-md">
            <CellCombobox
              selectedLabel={items.find((i) => i.id === lookupItem)?.label ?? ""}
              options={items} onSelect={lookup} placeholder="ابحث عن الصنف…"
            />
          </div>
          {locations && (
            locations.length === 0 ? (
              <p className="text-sm text-muted-foreground">الصنف ده مالوش موقع مسجّل — هيتاخد وقت في الدور عليه.</p>
            ) : (
              <div className="rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">الموقع</TableHead>
                      <TableHead className="text-start">الوصف</TableHead>
                      <TableHead className="text-start">المستودع</TableHead>
                      {canEdit && <TableHead className="w-10" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locations.map((l) => (
                      <TableRow key={l.binId}>
                        <TableCell className="font-mono text-sm" dir="ltr">
                          {l.code}
                          {l.isPrimary && <Badge className="ms-2" variant="secondary">أساسي</Badge>}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{l.nameAr ?? "—"}</TableCell>
                        <TableCell>{l.warehouseName}</TableCell>
                        {canEdit && (
                          <TableCell>
                            <Button size="icon" variant="ghost" aria-label="إلغاء" onClick={() => unassign(l.binId)}>
                              <Icon name="X" className="size-4 text-destructive" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
