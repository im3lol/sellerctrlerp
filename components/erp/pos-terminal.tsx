"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  getMyShiftAction, openShiftAction, ringSaleAction, closeShiftAction, type ShiftState,
} from "@/app/actions/erp/pos";
import { scanItemAction } from "@/app/actions/erp/item-search";
import {
  cartTotals, validatePayments, changeDue, METHOD_LABEL,
  type CartLine, type Payment, type PaymentMethod,
} from "@/lib/erp/pos";
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
type Row = CartLine & { code: string; name: string };

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const METHODS: PaymentMethod[] = ["CASH", "CARD", "WALLET", "VOUCHER"];

/**
 * The till. Scanning is the primary input — the box keeps focus and clears itself, so a
 * cashier with a scanner never touches the mouse. Everything the sale produces comes from
 * the ordinary invoice and receipt engines; this screen only decides what goes in them.
 */
export function PosTerminal({ warehouses, cashAccounts, customers, defaultCustomerId, vatRate }: {
  warehouses: Option[]; cashAccounts: Option[]; customers: Option[];
  defaultCustomerId: string | null; vatRate: number;
}) {
  const [state, setState] = useState<ShiftState | null>(null);
  const [pending, start] = useTransition();
  const scanRef = useRef<HTMLInputElement>(null);

  const [openForm, setOpenForm] = useState({ warehouseId: warehouses[0]?.id ?? "", cashAccountId: cashAccounts[0]?.id ?? "", float: "0" });
  const [cart, setCart] = useState<Row[]>([]);
  const [scan, setScan] = useState("");
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? "");
  const [applyVat, setApplyVat] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([{ method: "CASH", amount: 0 }]);
  const [closing, setClosing] = useState(false);
  const [counted, setCounted] = useState("");

  const load = () => {
    void getMyShiftAction().then((r) => {
      if (!r.ok) { toast.error(r.error ?? "تعذّر التحميل"); return; }
      setState(r.state ?? null);
    });
  };
  useEffect(() => { load(); }, []);

  const totals = useMemo(() => cartTotals(cart, vatRate, applyVat), [cart, vatRate, applyVat]);
  const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const change = changeDue(totals.total, payments);

  const openShift = () =>
    start(async () => {
      const r = await openShiftAction({
        warehouseId: openForm.warehouseId, cashAccountId: openForm.cashAccountId,
        openingFloat: Number(openForm.float) || 0,
      });
      if (r.ok) { toast.success(`فتحت وردية ${r.number}`); load(); }
      else toast.error(r.error ?? "تعذّر فتح الوردية");
    });

  const addScanned = () => {
    const code = scan.trim();
    if (!code) return;
    setScan("");
    void scanItemAction(code).then((it) => {
      if (!it) { toast.error("مفيش صنف بالكود ده"); return; }
      // Scanning the same barcode again bumps the line rather than adding a second one —
      // three of the same thing is one line with a 3 in it.
      setCart((c) => {
        const i = c.findIndex((x) => x.itemId === it.id);
        if (i >= 0) return c.map((x, k) => (k === i ? { ...x, quantity: x.quantity + 1 } : x));
        return [...c, { itemId: it.id, code: it.code, name: it.name || it.code, quantity: 1, unitPrice: Number(it.sellPrice) || 0, discount: 0 }];
      });
      scanRef.current?.focus();
    });
  };

  const ring = () =>
    void (async () => {
      if (!state?.shift) return;
      if (!cart.length) return toast.error("السلة فاضية");
      if (!customerId) return toast.error("اختر العميل");
      const err = validatePayments(totals.total, payments.filter((p) => p.amount > 0));
      if (err) return toast.error(err);
      start(async () => {
        const r = await ringSaleAction({
          shiftId: state.shift!.id,
          customerId,
          lines: cart.map((c) => ({ itemId: c.itemId, quantity: c.quantity, unitPrice: c.unitPrice, discount: c.discount ?? 0 })),
          payments: payments.filter((p) => p.amount > 0).map((p) => ({ method: p.method, amount: p.amount, reference: p.reference ?? null })),
          applyVat, vatRate,
        });
        if (!r.ok) { toast.error(r.error ?? "تعذّر إتمام البيع"); return; }
        toast.success(`${r.invoiceNumber}${r.change && r.change > 0 ? ` — الفكة ${money(r.change)}` : ""}`);
        setCart([]);
        setPayments([{ method: "CASH", amount: 0 }]);
        load();
        scanRef.current?.focus();
      });
    })();

  const close = () =>
    void (async () => {
      if (!state?.shift) return;
      const c = Number(counted) || 0;
      const expected = state.reconciliation?.expected ?? 0;
      const diff = Math.round((c - expected) * 100) / 100;
      const go = await confirm({
        danger: Math.abs(diff) > 0.005,
        title: `قفل وردية ${state.shift.number}؟`,
        description: diff === 0
          ? `الدرج مطابق (${money(expected)}).`
          : `المتوقّع ${money(expected)} والمعدود ${money(c)} — ${diff > 0 ? "زيادة" : "عجز"} ${money(Math.abs(diff))}. الفرق هيتسجّل على الوردية.`,
        confirmText: "اقفل الوردية", cancelText: "رجوع",
      });
      if (!go) return;
      start(async () => {
        const r = await closeShiftAction({ shiftId: state.shift!.id, countedCash: c });
        if (r.ok) { toast.success(`اتقفلت — الفرق ${money(r.difference ?? 0)}`); setClosing(false); setCounted(""); load(); }
        else toast.error(r.error ?? "تعذّر القفل");
      });
    })();

  if (!state) return null;

  // ── no shift open ────────────────────────────────────────────────────
  if (!state.shift) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>افتح وردية</CardTitle>
          <CardDescription>
            الوردية بتربط كل بيعة بالكاشير والدرج، وفي الآخر بتقارن اللي في الدرج باللي الدفاتر بتقوله.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>المخزن</Label>
              <select className={`${selectCls} w-48`} value={openForm.warehouseId}
                onChange={(e) => setOpenForm((f) => ({ ...f, warehouseId: e.target.value }))}>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>الخزينة</Label>
              <select className={`${selectCls} w-56`} value={openForm.cashAccountId}
                onChange={(e) => setOpenForm((f) => ({ ...f, cashAccountId: e.target.value }))}>
                {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
            <div className="space-y-2"><Label>رصيد افتتاحي في الدرج</Label>
              <Input type="number" step="0.01" min="0" className="w-32" value={openForm.float}
                onChange={(e) => setOpenForm((f) => ({ ...f, float: e.target.value }))} /></div>
            <Button onClick={openShift} disabled={pending || !openForm.warehouseId || !openForm.cashAccountId}>
              <Icon name="LogIn" className="size-4" />افتح
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── till ─────────────────────────────────────────────────────────────
  const r = state.reconciliation;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>وردية {state.shift.number}</CardTitle>
              <CardDescription>
                {state.sales.length} بيعة · إجمالي {money(r?.totalSales ?? 0)} · كاش في الدرج (متوقّع) {money(r?.expected ?? 0)}
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => setClosing((v) => !v)}>
              <Icon name="LogOut" className="size-4" />قفل الوردية
            </Button>
          </div>
        </CardHeader>
        {closing && (
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2"><Label>الكاش المعدود في الدرج</Label>
                <Input type="number" step="0.01" min="0" className="w-40" value={counted} autoFocus
                  onChange={(e) => setCounted(e.target.value)} /></div>
              <Button onClick={close} disabled={pending || counted === ""}>
                <Icon name="Check" className="size-4" />اقفل
              </Button>
              <span className="pb-2 text-sm text-muted-foreground">
                المتوقّع {money(r?.expected ?? 0)}
                {counted !== "" && ` · الفرق ${money((Number(counted) || 0) - (r?.expected ?? 0))}`}
              </span>
            </div>
          </CardContent>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>السلة</CardTitle>
            <CardDescription>امسح الباركود أو اكتب الكود واضغط Enter.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              ref={scanRef} autoFocus dir="ltr" className="font-mono text-lg"
              placeholder="امسح الباركود…"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addScanned(); } }}
            />

            {cart.length === 0 ? (
              <p className="text-sm text-muted-foreground">السلة فاضية.</p>
            ) : (
              <div className="rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">الصنف</TableHead>
                      <TableHead className="w-24 text-start">الكمية</TableHead>
                      <TableHead className="w-28 text-start">السعر</TableHead>
                      <TableHead className="w-28 text-start">خصم</TableHead>
                      <TableHead className="text-start">الإجمالي</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cart.map((l, i) => (
                      <TableRow key={l.itemId}>
                        <TableCell>
                          <div className="font-medium">{l.name}</div>
                          <div className="font-mono text-xs text-muted-foreground" dir="ltr">{l.code}</div>
                        </TableCell>
                        <TableCell>
                          <Input type="number" step="any" min="0" className="w-20 tabular-nums" value={l.quantity}
                            onChange={(e) => setCart((c) => c.map((x, k) => (k === i ? { ...x, quantity: Number(e.target.value) || 0 } : x)))} />
                        </TableCell>
                        <TableCell>
                          <Input type="number" step="0.01" min="0" className="w-24 tabular-nums" value={l.unitPrice}
                            onChange={(e) => setCart((c) => c.map((x, k) => (k === i ? { ...x, unitPrice: Number(e.target.value) || 0 } : x)))} />
                        </TableCell>
                        <TableCell>
                          <Input type="number" step="0.01" min="0" className="w-24 tabular-nums" value={l.discount ?? 0}
                            onChange={(e) => setCart((c) => c.map((x, k) => (k === i ? { ...x, discount: Number(e.target.value) || 0 } : x)))} />
                        </TableCell>
                        <TableCell className="font-medium tabular-nums">
                          {money(l.quantity * l.unitPrice - (l.discount ?? 0))}
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" aria-label="حذف"
                            onClick={() => setCart((c) => c.filter((_, k) => k !== i))}>
                            <Icon name="X" className="size-4 text-destructive" />
                          </Button>
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
            <CardTitle>الدفع</CardTitle>
            <CardDescription>الفكة كاش بس — البطاقة مفيهاش فكة.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>العميل</Label>
              <CellCombobox
                selectedLabel={customers.find((c) => c.id === customerId)?.label ?? ""}
                options={customers} onSelect={setCustomerId} placeholder="عميل نقدي…"
              />
            </div>

            <div className="space-y-1 rounded-lg border p-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">الإجمالي</span><span className="tabular-nums">{money(totals.subtotal)}</span></div>
              {totals.discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">الخصم</span><span className="tabular-nums">−{money(totals.discount)}</span></div>}
              {applyVat && <div className="flex justify-between"><span className="text-muted-foreground">ضريبة {vatRate}%</span><span className="tabular-nums">{money(totals.tax)}</span></div>}
              <div className="flex justify-between border-t pt-1 text-base font-bold"><span>المطلوب</span><span className="tabular-nums">{money(totals.total)}</span></div>
            </div>

            {vatRate > 0 && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 rounded border-input" checked={applyVat} onChange={(e) => setApplyVat(e.target.checked)} />
                إضافة ضريبة القيمة المضافة
              </label>
            )}

            <div className="space-y-2">
              {payments.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <select className={`${selectCls} w-32`} value={p.method}
                    onChange={(e) => setPayments((ps) => ps.map((x, k) => (k === i ? { ...x, method: e.target.value as PaymentMethod } : x)))}>
                    {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
                  </select>
                  <Input type="number" step="0.01" min="0" className="tabular-nums" value={p.amount || ""}
                    placeholder="0"
                    onChange={(e) => setPayments((ps) => ps.map((x, k) => (k === i ? { ...x, amount: Number(e.target.value) || 0 } : x)))} />
                  {payments.length > 1 && (
                    <Button size="icon" variant="ghost" aria-label="حذف"
                      onClick={() => setPayments((ps) => ps.filter((_, k) => k !== i))}>
                      <Icon name="X" className="size-4 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setPayments((ps) => [...ps, { method: "CARD", amount: 0 }])}>
                  <Icon name="Plus" className="size-4" />طريقة تانية
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPayments((ps) => ps.map((x, k) => (k === 0 ? { ...x, amount: totals.total } : x)).slice(0, 1))}>
                  المبلغ بالظبط
                </Button>
              </div>
            </div>

            {paid > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{paid >= totals.total ? "الفكة" : "الباقي"}</span>
                <span className={`font-bold tabular-nums ${paid >= totals.total ? "text-emerald-600" : "text-destructive"}`}>
                  {money(paid >= totals.total ? change : totals.total - paid)}
                </span>
              </div>
            )}

            <Button className="w-full" size="lg" onClick={ring} disabled={pending || !cart.length}>
              <Icon name="Check" className="size-4" />إتمام البيع
            </Button>
          </CardContent>
        </Card>
      </div>

      {state.sales.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>مبيعات الوردية</CardTitle>
            <CardDescription>{state.sales.length} فاتورة</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الفاتورة</TableHead>
                    <TableHead className="text-start">الدفع</TableHead>
                    <TableHead className="text-start">الإجمالي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.sales.map((s) => (
                    <TableRow key={s.invoiceId}>
                      <TableCell className="font-mono text-xs">{s.invoiceNumber}</TableCell>
                      <TableCell><Badge variant="outline">{s.methods}</Badge></TableCell>
                      <TableCell className="font-medium tabular-nums">{money(s.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
