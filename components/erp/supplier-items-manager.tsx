"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getSupplierItemsAction, saveSupplierItemsAction, type SupplierItemRow } from "@/app/actions/erp/supplier-items";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/icon";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { cn } from "@/lib/utils";

type Draft = {
  key: string; supplierId: string; supplierName: string; sku: string;
  price: string; minQty: string; leadDays: string; isPreferred: boolean; lastOrderedAt: string | null;
};

const str = (v: number | null) => (v == null ? "" : String(v));
const num = (v: string) => (v.trim() === "" ? null : Number(v));
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("ar-EG-u-nu-latn", { day: "numeric", month: "short", year: "numeric" }) : "—";

const toDraft = (r: SupplierItemRow): Draft => ({
  key: r.supplierId, supplierId: r.supplierId, supplierName: r.supplierName, sku: r.supplierSku ?? "",
  price: str(r.unitPrice), minQty: str(r.minQty), leadDays: str(r.leadDays), isPreferred: r.isPreferred,
  lastOrderedAt: r.lastOrderedAt,
});

/**
 * Who we buy this item from, and on what terms. Confirmed purchase orders and awarded
 * quotations keep the prices current by themselves; the preferred supplier is the one
 * reorder and a new purchase order reach for first.
 */
export function SupplierItemsManager({ itemId, canEdit }: { itemId: string; canEdit: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Draft[]>([]);
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "hidden">("loading");
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await getSupplierItemsAction(itemId);
      if (!alive) return;
      if (!r.ok) { setState("hidden"); return; }
      setRows((r.rows ?? []).map(toDraft));
      setOptions(r.suppliers ?? []);
      setState("ready");
    })();
    return () => { alive = false; };
  }, [itemId]);

  const patch = (key: string, p: Partial<Draft>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const addRow = () => setRows((rs) => [...rs, {
    key: `new-${Date.now()}`, supplierId: "", supplierName: "", sku: "", price: "", minQty: "", leadDays: "",
    // The first supplier added is the one to buy from, almost always.
    isPreferred: rs.length === 0, lastOrderedAt: null,
  }]);
  const remove = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));
  const togglePreferred = (key: string) =>
    setRows((rs) => rs.map((r) => ({ ...r, isPreferred: r.key === key ? !r.isPreferred : false })));

  const save = () => {
    if (rows.some((r) => !r.supplierId)) return toast.error("اختر المورد لكل سطر");
    start(async () => {
      const res = await saveSupplierItemsAction({
        itemId,
        rows: rows.map((r) => ({
          supplierId: r.supplierId, supplierSku: r.sku.trim() || null,
          unitPrice: num(r.price), minQty: num(r.minQty), leadDays: num(r.leadDays), isPreferred: r.isPreferred,
        })),
      });
      if (res.ok) { toast.success("تم حفظ موردي الصنف"); router.refresh(); }
      else toast.error(res.error ?? "تعذّر الحفظ");
    });
  };

  if (state !== "ready") return null;
  if (!canEdit && rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>الموردون</CardTitle>
            <CardDescription>
              بتشتري الصنف ده من مين وبكام. أوامر الشراء المؤكدة بتحدّث السعر لوحدها، و«المفضّل» هو اللي إعادة الطلب
              وأمر الشراء الجديد بيختاروه الأول، بمدة توريده وأقل كمية بيبيعها.
            </CardDescription>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={addRow} disabled={pending}>
                <Icon name="Plus" className="size-4" />مورد
              </Button>
              <Button size="sm" onClick={save} disabled={pending}>
                <Icon name="Check" className="size-4" />حفظ
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">لسه مفيش موردين للصنف ده — أول أمر شراء يتأكد هيضيف مورده هنا.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">المورد</TableHead>
                  <TableHead className="text-start">كود المورد</TableHead>
                  <TableHead className="text-start">السعر</TableHead>
                  <TableHead className="text-start">أقل كمية</TableHead>
                  <TableHead className="text-start">التوريد (يوم)</TableHead>
                  <TableHead className="text-start">مفضّل</TableHead>
                  <TableHead className="text-start">آخر طلب</TableHead>
                  {canEdit && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="min-w-44">
                      {canEdit && !r.lastOrderedAt ? (
                        <CellCombobox
                          selectedLabel={options.find((o) => o.id === r.supplierId)?.label ?? r.supplierName}
                          options={options.filter((o) => o.id === r.supplierId || !rows.some((x) => x.supplierId === o.id))}
                          onSelect={(id, label) => patch(r.key, { supplierId: id, supplierName: label })}
                          placeholder="اختر المورد…"
                        />
                      ) : (
                        <span className="font-medium">{r.supplierName || "—"}</span>
                      )}
                    </TableCell>
                    {(["sku", "price", "minQty", "leadDays"] as const).map((f) => (
                      <TableCell key={f} className="w-32">
                        {canEdit ? (
                          <Input
                            className={cn("w-28", f !== "sku" && "tabular-nums")}
                            type={f === "sku" ? "text" : "number"} min="0" step={f === "leadDays" ? "1" : "any"}
                            dir={f === "sku" ? "ltr" : undefined}
                            value={r[f]} placeholder={f === "sku" ? "اختياري" : "—"}
                            onChange={(e) => patch(r.key, { [f]: e.target.value })}
                          />
                        ) : (
                          <span className="tabular-nums">{r[f] || "—"}</span>
                        )}
                      </TableCell>
                    ))}
                    <TableCell>
                      <button
                        type="button" disabled={!canEdit} onClick={() => togglePreferred(r.key)}
                        aria-label={r.isPreferred ? "المورد المفضّل" : "اجعله المفضّل"}
                        className={cn("rounded-md p-1 transition-colors", canEdit && "hover:bg-accent")}
                      >
                        <Icon name="Star" className={cn("size-4", r.isPreferred ? "fill-amber-400 text-amber-500" : "text-muted-foreground")} />
                      </button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{when(r.lastOrderedAt)}</TableCell>
                    {canEdit && (
                      <TableCell>
                        <Button size="icon" variant="ghost" aria-label="حذف" onClick={() => remove(r.key)}>
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
