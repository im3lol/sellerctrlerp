"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  savePromotionAction, deletePromotionAction, saveLoyaltySettingsAction,
} from "@/app/actions/erp/promotions";
import { activePromotions, type Promotion } from "@/lib/erp/promotions";
import { pointsValue, type LoyaltyProgram } from "@/lib/erp/loyalty";
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

export type PromotionRow = Promotion & { code: string; isActive: boolean; itemLabel: string | null; notes: string | null };
export type ItemOption = { id: string; label: string };

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_LABEL: Record<Promotion["type"], string> = {
  PERCENT: "نسبة",
  AMOUNT: "مبلغ لكل قطعة",
  BUY_X_GET_Y: "اشترِ واحصل",
};

const blank = {
  id: "" as string | undefined, nameAr: "", type: "PERCENT" as Promotion["type"], value: "",
  itemId: "", minQuantity: "", minAmount: "", buyQty: "", getQty: "",
  startsAt: "", endsAt: "", priority: "0", isActive: true, notes: "",
};

/** How the rule reads in one line — the shop owner should not have to decode the columns. */
function describe(p: Promotion): string {
  const on = p.itemId ? "على الصنف" : "على الفاتورة كلها";
  const min = p.minAmount > 0 ? ` فوق ${money(p.minAmount)}` : p.minQuantity > 0 ? ` من ${p.minQuantity} قطعة` : "";
  switch (p.type) {
    case "PERCENT": return `خصم ${p.value}٪ ${on}${min}`;
    case "AMOUNT": return `خصم ${money(p.value)} ${p.itemId ? "لكل قطعة" : "على الفاتورة"}${min}`;
    case "BUY_X_GET_Y": return `اشترِ ${p.buyQty} تاخد ${p.getQty} ببلاش`;
  }
}

export function PromotionsManager({ rows, items, loyalty, canManage, canEditSettings }: {
  rows: PromotionRow[]; items: ItemOption[]; loyalty: LoyaltyProgram;
  canManage: boolean; canEditSettings: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState<typeof blank | null>(null);
  const [prog, setProg] = useState({
    earnRate: String(loyalty.earnRate), redeemRate: String(loyalty.redeemRate), minRedeem: String(loyalty.minRedeem),
  });

  const live = useMemo(() => new Set(activePromotions(rows.filter((r) => r.isActive)).map((p) => p.id)), [rows]);
  const set = (k: keyof typeof blank, v: string | boolean) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = () =>
    start(async () => {
      if (!form) return;
      const r = await savePromotionAction({
        id: form.id || undefined,
        nameAr: form.nameAr, type: form.type, value: Number(form.value) || 0,
        itemId: form.itemId || null,
        minQuantity: Number(form.minQuantity) || 0, minAmount: Number(form.minAmount) || 0,
        buyQty: Number(form.buyQty) || 0, getQty: Number(form.getQty) || 0,
        startsAt: form.startsAt || null, endsAt: form.endsAt || null,
        priority: Number(form.priority) || 0, isActive: form.isActive, notes: form.notes || null,
      });
      if (!r.ok) { toast.error(r.error ?? "تعذّر الحفظ"); return; }
      toast.success("اتحفظ");
      setForm(null);
      router.refresh();
    });

  const remove = (row: PromotionRow) =>
    void (async () => {
      const go = await confirm({
        danger: true,
        title: `تمسح «${row.nameAr}»؟`,
        description: "الفواتير اللي اتخصمت بالعرض ده مش هتتغيّر — الخصم اتسجّل عليها خلاص. المسح بيوقف العرض على البيع الجاي بس.",
        confirmText: "امسح", cancelText: "رجوع",
      });
      if (!go) return;
      start(async () => {
        const r = await deletePromotionAction(row.id);
        if (r.ok) { toast.success("اتمسح"); router.refresh(); }
        else toast.error(r.error ?? "تعذّر المسح");
      });
    })();

  const saveProgram = () =>
    start(async () => {
      const r = await saveLoyaltySettingsAction({
        earnRate: Number(prog.earnRate) || 0,
        redeemRate: Number(prog.redeemRate) || 0,
        minRedeem: Number(prog.minRedeem) || 0,
      });
      if (r.ok) { toast.success("اتحفظ"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });

  const earn = Number(prog.earnRate) || 0;
  const redeemRate = Number(prog.redeemRate) || 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>العروض</CardTitle>
              <CardDescription>
                بتتطبّق لوحدها على نقطة البيع. السطر بياخد عرض واحد — الأكبر خصماً — والعروض مبتتجمّعش فوق بعض.
              </CardDescription>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => setForm({ ...blank })}>
                <Icon name="Plus" className="size-4" />عرض جديد
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {form && (
            <div className="space-y-4 rounded-xl border p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2 sm:col-span-2">
                  <Label>الاسم</Label>
                  <Input value={form.nameAr} autoFocus placeholder="خصم رمضان"
                    onChange={(e) => set("nameAr", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>النوع</Label>
                  <select className={selectCls} value={form.type} onChange={(e) => set("type", e.target.value)}>
                    {(Object.keys(TYPE_LABEL) as Promotion["type"][]).map((t) => (
                      <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                    ))}
                  </select>
                </div>
                {form.type !== "BUY_X_GET_Y" ? (
                  <div className="space-y-2">
                    <Label>{form.type === "PERCENT" ? "النسبة ٪" : "المبلغ"}</Label>
                    <Input type="number" step="0.01" min="0" value={form.value} onChange={(e) => set("value", e.target.value)} />
                  </div>
                ) : (
                  <>
                    <div className="space-y-2"><Label>يشتري</Label>
                      <Input type="number" step="1" min="1" value={form.buyQty} onChange={(e) => set("buyQty", e.target.value)} /></div>
                    <div className="space-y-2"><Label>ياخد ببلاش</Label>
                      <Input type="number" step="1" min="1" value={form.getQty} onChange={(e) => set("getQty", e.target.value)} /></div>
                  </>
                )}
                <div className="space-y-2 sm:col-span-2">
                  <Label>الصنف</Label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <CellCombobox
                        selectedLabel={items.find((i) => i.id === form.itemId)?.label ?? ""}
                        options={items}
                        onSelect={(id) => set("itemId", id)}
                        placeholder="سيبه فاضي = العرض على الفاتورة كلها"
                      />
                    </div>
                    {form.itemId && (
                      <Button size="icon" variant="ghost" aria-label="شيل الصنف" onClick={() => set("itemId", "")}>
                        <Icon name="X" className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="space-y-2"><Label>أقل كمية</Label>
                  <Input type="number" step="any" min="0" value={form.minQuantity} onChange={(e) => set("minQuantity", e.target.value)} /></div>
                <div className="space-y-2"><Label>أقل مبلغ</Label>
                  <Input type="number" step="0.01" min="0" value={form.minAmount} onChange={(e) => set("minAmount", e.target.value)} /></div>
                <div className="space-y-2"><Label>من تاريخ</Label>
                  <Input type="date" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></div>
                <div className="space-y-2"><Label>لتاريخ</Label>
                  <Input type="date" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 rounded border-input" checked={form.isActive}
                    onChange={(e) => set("isActive", e.target.checked)} />
                  مفعّل
                </label>
                <Button onClick={save} disabled={pending || !form.nameAr.trim()}>
                  <Icon name="Check" className="size-4" />احفظ
                </Button>
                <Button variant="ghost" onClick={() => setForm(null)}>رجوع</Button>
              </div>
            </div>
          )}

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">مفيش عروض. العرض بيشتغل لوحده على الكاشير أول ما تعمله.</p>
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الكود</TableHead>
                    <TableHead className="text-start">العرض</TableHead>
                    <TableHead className="text-start">على</TableHead>
                    <TableHead className="text-start">المدة</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell>
                        <div className="font-medium">{r.nameAr}</div>
                        <div className="text-xs text-muted-foreground">{describe(r)}</div>
                      </TableCell>
                      <TableCell className="text-sm">{r.itemLabel ?? "الفاتورة كلها"}</TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {r.startsAt || r.endsAt ? `${r.startsAt || "—"} ← ${r.endsAt || "—"}` : "دائم"}
                      </TableCell>
                      <TableCell>
                        {!r.isActive ? <Badge variant="outline">موقوف</Badge>
                          : live.has(r.id) ? <Badge className="bg-emerald-600">شغّال دلوقتي</Badge>
                          : <Badge variant="outline">بره المدة</Badge>}
                      </TableCell>
                      <TableCell>
                        {canManage && (
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" aria-label="تعديل" onClick={() => setForm({
                              id: r.id, nameAr: r.nameAr, type: r.type, value: String(r.value),
                              itemId: r.itemId ?? "", minQuantity: String(r.minQuantity), minAmount: String(r.minAmount),
                              buyQty: String(r.buyQty), getQty: String(r.getQty),
                              startsAt: r.startsAt ?? "", endsAt: r.endsAt ?? "",
                              priority: String(r.priority), isActive: r.isActive, notes: r.notes ?? "",
                            })}>
                              <Icon name="Edit" className="size-4" />
                            </Button>
                            <Button size="icon" variant="ghost" aria-label="مسح" onClick={() => remove(r)}>
                              <Icon name="Trash2" className="size-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>نقط الولاء</CardTitle>
          <CardDescription>
            العميل بيكسب نقط على كل بيعة، وبيصرفها كخصم على بيعة بعدين. صفر في الكسب = البرنامج مقفول.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2"><Label>نقط لكل جنيه</Label>
              <Input type="number" step="0.01" min="0" className="w-32 tabular-nums" value={prog.earnRate}
                disabled={!canEditSettings} onChange={(e) => setProg((p) => ({ ...p, earnRate: e.target.value }))} /></div>
            <div className="space-y-2"><Label>قيمة النقطة بالجنيه</Label>
              <Input type="number" step="0.01" min="0" className="w-32 tabular-nums" value={prog.redeemRate}
                disabled={!canEditSettings} onChange={(e) => setProg((p) => ({ ...p, redeemRate: e.target.value }))} /></div>
            <div className="space-y-2"><Label>أقل رصيد للاستبدال</Label>
              <Input type="number" step="1" min="0" className="w-32 tabular-nums" value={prog.minRedeem}
                disabled={!canEditSettings} onChange={(e) => setProg((p) => ({ ...p, minRedeem: e.target.value }))} /></div>
            {canEditSettings && (
              <Button onClick={saveProgram} disabled={pending}>
                <Icon name="Check" className="size-4" />احفظ
              </Button>
            )}
          </div>

          {earn > 0 && redeemRate > 0 && (
            <p className="text-sm text-muted-foreground">
              يعني: عميل اشترى بـ ١٠٠٠ جنيه بياخد {Math.floor(1000 * earn)} نقطة، تساوي{" "}
              {money(pointsValue(Math.floor(1000 * earn), { earnRate: earn, redeemRate, minRedeem: 0 }))} جنيه خصم —
              أي {money((pointsValue(Math.floor(1000 * earn), { earnRate: earn, redeemRate, minRedeem: 0 }) / 1000) * 100)}٪
              بترجّعها للعميل من كل بيعة.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
