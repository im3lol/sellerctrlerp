"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getItemUnitsAction, saveItemUnitsAction, type ItemUnitRow } from "@/app/actions/erp/item-units";
import { validateUnitSet } from "@/lib/erp/item-units";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { CellCombobox } from "@/components/erp/cell-combobox";

type Draft = { key: string; uomId: string; label: string; factor: string; isBase: boolean; barcode: string; inUse: boolean };

const toDraft = (r: ItemUnitRow): Draft => ({
  key: r.id, uomId: r.uomId, label: r.label, factor: String(r.factor),
  isBase: r.isBase, barcode: r.barcode ?? "", inUse: r.inUse,
});

/**
 * Units this item can be bought and sold in. The factor says how many BASE units one of
 * this unit holds — a carton of 12 is 12. Stock, cost and the ledger stay in the base
 * unit no matter which unit a document was typed in, so nothing here can move a number
 * in the accounts.
 */
export function ItemUnitsManager({ itemId, canEdit }: { itemId: string; canEdit: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Draft[]>([]);
  const [allUoms, setAllUoms] = useState<{ id: string; label: string }[]>([]);
  const [baseLabel, setBaseLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await getItemUnitsAction(itemId);
      if (!alive) return;
      setLoading(false);
      if (!r.ok) { toast.error(r.error ?? "تعذّر تحميل الوحدات"); return; }
      setRows((r.units ?? []).map(toDraft));
      setAllUoms(r.allUoms ?? []);
      setBaseLabel(r.baseLabel ?? "");
    })();
    return () => { alive = false; };
  }, [itemId]);

  const addRow = () =>
    setRows((rs) => [...rs, {
      key: `new-${Date.now()}`, uomId: "", label: "", factor: "",
      // The first row a user adds is the base — that is what they almost always mean.
      isBase: rs.length === 0, barcode: "", inUse: false,
    }]);

  const patch = (key: string, p: Partial<Draft>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const remove = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));

  const setBase = (key: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, isBase: true, factor: "1" } : { ...r, isBase: false })));

  const save = () => {
    const units = rows
      .filter((r) => r.uomId)
      .map((r) => ({ uomId: r.uomId, factor: Number(r.factor), isBase: r.isBase, barcode: r.barcode.trim() || null }));
    if (rows.some((r) => !r.uomId)) return toast.error("اختر الوحدة لكل سطر");
    const err = validateUnitSet(units);
    if (err) return toast.error(err);
    start(async () => {
      const res = await saveItemUnitsAction({ itemId, units });
      if (res.ok) { toast.success("تم حفظ وحدات الصنف"); router.refresh(); }
      else toast.error(res.error ?? "تعذّر الحفظ");
    });
  };

  if (loading) return null;
  if (!canEdit && rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>وحدات القياس</CardTitle>
            <CardDescription>
              اشترِ بالكرتونة وبِع بالقطعة. المعامل = كام وحدة أساسية جوّه الوحدة دي.
              المخزون والتكلفة بيتخزّنوا بالوحدة الأساسية دايماً{baseLabel ? ` (${baseLabel})` : ""}.
            </CardDescription>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={addRow} disabled={pending}>
                <Icon name="Plus" className="size-4" />وحدة
              </Button>
              <Button size="sm" onClick={save} disabled={pending || rows.length === 0}>
                <Icon name="Check" className="size-4" />حفظ
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            مفيش وحدات إضافية — الصنف بيتعامل بوحدته الأساسية بس{baseLabel ? ` (${baseLabel})` : ""}.
          </p>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الوحدة</TableHead>
                  <TableHead className="text-start">المعامل</TableHead>
                  <TableHead className="text-start">باركود الوحدة</TableHead>
                  <TableHead className="text-start">أساسية</TableHead>
                  {canEdit && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="min-w-40">
                      {canEdit && !r.inUse ? (
                        <CellCombobox
                          selectedLabel={allUoms.find((u) => u.id === r.uomId)?.label ?? r.label}
                          options={allUoms.map((u) => ({ id: u.id, label: u.label }))}
                          onSelect={(id, label) => patch(r.key, { uomId: id, label })}
                          placeholder="اختر الوحدة…"
                        />
                      ) : (
                        <span className="font-medium">{r.label || "—"}</span>
                      )}
                    </TableCell>
                    <TableCell className="w-32">
                      {canEdit && !r.inUse && !r.isBase ? (
                        <Input
                          type="number" step="0.000001" min="0" className="w-28"
                          value={r.factor} placeholder="12"
                          onChange={(e) => patch(r.key, { factor: e.target.value })}
                        />
                      ) : (
                        <span className="tabular-nums">{r.factor || "1"}</span>
                      )}
                    </TableCell>
                    <TableCell className="w-44">
                      {canEdit ? (
                        <Input
                          className="w-40" value={r.barcode} placeholder="اختياري"
                          onChange={(e) => patch(r.key, { barcode: e.target.value })}
                        />
                      ) : (
                        <span className="font-mono text-xs">{r.barcode || "—"}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.isBase ? (
                        <Badge variant="secondary">أساسية</Badge>
                      ) : canEdit && !r.inUse ? (
                        <Button size="sm" variant="ghost" onClick={() => setBase(r.key)}>اجعلها أساسية</Button>
                      ) : null}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        {r.inUse ? (
                          <span title="مستخدمة في مستندات — المعامل مقفول"><Icon name="Lock" className="size-4 text-muted-foreground" /></span>
                        ) : (
                          <Button size="icon" variant="ghost" aria-label="حذف" onClick={() => remove(r.key)}>
                            <Icon name="Trash2" className="size-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {rows.some((r) => r.inUse) && (
          <p className="mt-3 text-xs text-muted-foreground">
            الوحدات المقفولة اتسجّلت عليها مستندات — تعديل معاملها كان هيغيّر كميات محفوظة بأثر رجعي.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
