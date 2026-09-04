"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { savePriceListAction, deletePriceListAction } from "@/app/actions/erp/price-lists";
import { validatePriceRows } from "@/lib/erp/price-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { PaginatedTableRows } from "@/components/erp/paginated-table-rows";

type ListRow = {
  id: string; code: string; nameAr: string; isDefault: boolean; isActive: boolean;
  validFrom: string; validTo: string; notes: string; customerCount: number;
};
type PriceRow = { itemId: string; price: number; minQuantity: number; code: string; name: string };
type Item = { id: string; code: string; nameAr: string; sellPrice: number };

type Draft = ListRow & { rows: PriceRow[] };

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

const blank = (): Draft => ({
  id: "", code: "", nameAr: "", isDefault: false, isActive: true,
  validFrom: "", validTo: "", notes: "", customerCount: 0, rows: [],
});

/**
 * Price lists and their rows. A row's «من كمية» is a quantity break: the price applies
 * from that quantity up, so one item can carry a retail price and a bulk price on the
 * same list.
 */
export function PriceListsManager({
  lists, rowsByList, items, canManage,
}: {
  lists: ListRow[];
  rowsByList: Record<string, PriceRow[]>;
  items: Item[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const edit = (l: ListRow) => setDraft({ ...l, rows: rowsByList[l.id] ?? [] });

  const addRow = () =>
    setDraft((d) => (d ? { ...d, rows: [...d.rows, { itemId: "", price: 0, minQuantity: 0, code: "", name: "" }] } : d));

  const patchRow = (i: number, p: Partial<PriceRow>) =>
    setDraft((d) => (d ? { ...d, rows: d.rows.map((r, k) => (k === i ? { ...r, ...p } : r)) } : d));

  const removeRow = (i: number) =>
    setDraft((d) => (d ? { ...d, rows: d.rows.filter((_, k) => k !== i) } : d));

  const save = () => {
    if (!draft) return;
    if (!draft.code.trim() || !draft.nameAr.trim()) return toast.error("الكود والاسم مطلوبين");
    const err = validatePriceRows(draft.rows);
    if (err) return toast.error(err);
    start(async () => {
      const r = await savePriceListAction({
        id: draft.id || undefined,
        code: draft.code.trim(), nameAr: draft.nameAr.trim(), isDefault: draft.isDefault,
        isActive: draft.isActive, validFrom: draft.validFrom || null, validTo: draft.validTo || null,
        notes: draft.notes || null,
        rows: draft.rows.map((r) => ({ itemId: r.itemId, price: r.price, minQuantity: r.minQuantity })),
      });
      if (r.ok) { toast.success("تم حفظ القائمة"); setDraft(null); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  const remove = (l: ListRow) =>
    void (async () => {
      const go = await confirm({
        danger: true,
        title: `حذف قائمة «${l.nameAr}»؟`,
        description: l.customerCount > 0
          ? `${l.customerCount} عميل مربوطين بالقائمة دي — هيرجعوا للقائمة الافتراضية.`
          : "القائمة وأسعارها هيتمسحوا. الفواتير القديمة مش هتتأثر — سعرها متسجّل فيها.",
        confirmText: "احذف", cancelText: "رجوع",
      });
      if (!go) return;
      start(async () => {
        const r = await deletePriceListAction(l.id);
        if (r.ok) { toast.success("تم الحذف"); router.refresh(); }
        else toast.error(r.error ?? "تعذّر الحذف");
      });
    })();

  if (draft) {
    return (
      <Card>
        <CardHeader>
          <div className="flex w-full flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{draft.id ? `تعديل ${draft.nameAr || "قائمة"}` : "قائمة أسعار جديدة"}</CardTitle>
              <CardDescription>الأصناف اللي مش في القائمة بتاخد سعر البيع المسجّل على الصنف نفسه.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={pending}><Icon name="Check" className="size-4" />حفظ</Button>
              <Button size="sm" variant="outline" onClick={() => setDraft(null)} disabled={pending}>إلغاء</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="space-y-2"><Label>الكود</Label>
              <Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="WHOLESALE" /></div>
            <div className="space-y-2"><Label>الاسم</Label>
              <Input value={draft.nameAr} onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })} placeholder="أسعار الجملة" /></div>
            <div className="space-y-2"><Label>سارية من</Label>
              <Input type="date" value={draft.validFrom} onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })} /></div>
            <div className="space-y-2"><Label>سارية حتى</Label>
              <Input type="date" value={draft.validTo} onChange={(e) => setDraft({ ...draft, validTo: e.target.value })} /></div>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 rounded border-input" checked={draft.isDefault}
                onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />
              القائمة الافتراضية للشركة
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 rounded border-input" checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
              مفعّلة
            </label>
            <div className="ms-auto">
              <Button size="sm" variant="outline" onClick={addRow} disabled={pending}>
                <Icon name="Plus" className="size-4" />صنف
              </Button>
            </div>
          </div>

          {draft.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">مفيش أصناف في القائمة — أضف صنف وسعره.</p>
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الصنف</TableHead>
                    <TableHead className="w-32 text-start">من كمية</TableHead>
                    <TableHead className="w-32 text-start">السعر</TableHead>
                    <TableHead className="w-32 text-start">سعر الصنف</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <PaginatedTableRows rows={draft.rows.map((r, i) => (
                    <TableRow key={`${r.itemId}-${r.minQuantity}-${i}`}>
                      <TableCell className="min-w-64">
                        <CellCombobox
                          selectedLabel={itemById.get(r.itemId) ? `${itemById.get(r.itemId)!.code} — ${itemById.get(r.itemId)!.nameAr}` : ""}
                          options={items.map((it) => ({ id: it.id, label: `${it.code} — ${it.nameAr}` }))}
                          onSelect={(id) => patchRow(i, { itemId: id })}
                          placeholder="ابحث عن الصنف…"
                        />
                      </TableCell>
                      <TableCell>
                        <Input type="number" step="any" min="0" className="w-28 tabular-nums" value={r.minQuantity}
                          onChange={(e) => patchRow(i, { minQuantity: Number(e.target.value) || 0 })} />
                      </TableCell>
                      <TableCell>
                        <Input type="number" step="0.01" min="0" className="w-28 tabular-nums" value={r.price}
                          onChange={(e) => patchRow(i, { price: Number(e.target.value) || 0 })} />
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {itemById.get(r.itemId) ? money(itemById.get(r.itemId)!.sellPrice) : "—"}
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" aria-label="حذف" onClick={() => removeRow(i)}>
                          <Icon name="Trash2" className="size-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))} />
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>قوائم الأسعار</CardTitle>
            <CardDescription>{lists.length ? `${lists.length} قائمة` : "لسه مفيش قوائم"}</CardDescription>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setDraft(blank())}>
              <Icon name="Plus" className="size-4" />قائمة جديدة
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {lists.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            من غير قوائم، كل عميل بيشتري بسعر البيع المسجّل على الصنف. أنشئ قائمة جملة وقائمة تجزئة واربط كل عميل بواحدة.
          </p>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الكود</TableHead>
                  <TableHead className="text-start">الاسم</TableHead>
                  <TableHead className="text-start">أصناف</TableHead>
                  <TableHead className="text-start">عملاء</TableHead>
                  <TableHead className="text-start">السريان</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  {canManage && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lists.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{l.code}</TableCell>
                    <TableCell className="font-medium">{l.nameAr}</TableCell>
                    <TableCell className="tabular-nums">{qf((rowsByList[l.id] ?? []).length)}</TableCell>
                    <TableCell className="tabular-nums">{qf(l.customerCount)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {l.validFrom || l.validTo ? `${l.validFrom || "—"} ← ${l.validTo || "—"}` : "دائمة"}
                    </TableCell>
                    <TableCell className="space-x-1 space-x-reverse">
                      {l.isDefault && <Badge variant="secondary">افتراضية</Badge>}
                      {!l.isActive && <Badge variant="outline">موقوفة</Badge>}
                    </TableCell>
                    {canManage && (
                      <TableCell className="flex gap-1">
                        <Button size="icon" variant="ghost" aria-label="تعديل" onClick={() => edit(l)}>
                          <Icon name="Edit" className="size-4" />
                        </Button>
                        <Button size="icon" variant="ghost" aria-label="حذف" onClick={() => remove(l)}>
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
  );
}
