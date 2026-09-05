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
import { usePosQueue, cacheItem, cachedItem } from "@/components/erp/pos-offline";
import { newClientRef, canQueueOffline, drawerAdjustment, failed as failedSales, pending as pendingSales } from "@/lib/erp/pos-sync";
import { applyPromotions, spreadDiscount, type Promotion } from "@/lib/erp/promotions";
import { maxRedeemable, pointsValue, validateRedeem, type LoyaltyProgram } from "@/lib/erp/loyalty";
import { getLoyaltyBalanceAction } from "@/app/actions/erp/promotions";
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
export function PosTerminal({ warehouses, cashAccounts, customers, defaultCustomerId, vatRate, promotions, loyalty }: {
  warehouses: Option[]; cashAccounts: Option[]; customers: Option[];
  defaultCustomerId: string | null; vatRate: number;
  promotions: Promotion[]; loyalty: LoyaltyProgram;
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
  const [points, setPoints] = useState(0);
  const [redeem, setRedeem] = useState("");
  const q = usePosQueue();

  const load = () => {
    void getMyShiftAction().then((r) => {
      if (!r.ok) { toast.error(r.error ?? "تعذّر التحميل"); return; }
      setState(r.state ?? null);
    });
  };
  useEffect(() => { load(); }, []);

  // What the rules take off. The server runs them again and is the authority; this is so
  // the cashier can tell the customer the price before they hand over money.
  const promo = useMemo(
    () => applyPromotions(cart.map((c) => ({ itemId: c.itemId, quantity: c.quantity, unitPrice: c.unitPrice, discount: c.discount ?? 0 })), promotions),
    [cart, promotions],
  );
  const redeemPoints = Math.max(0, Math.floor(Number(redeem) || 0));
  const redeemAmount = redeemPoints > 0 ? pointsValue(redeemPoints, loyalty) : 0;
  const totals = useMemo(
    () => cartTotals(redeemAmount > 0 ? spreadDiscount(promo.lines, redeemAmount) : promo.lines, vatRate, applyVat),
    [promo.lines, redeemAmount, vatRate, applyVat],
  );
  const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const change = changeDue(totals.total, payments);
  const canRedeem = q.online && loyalty.redeemRate > 0;
  const beforePoints = useMemo(() => cartTotals(promo.lines, vatRate, applyVat).total, [promo.lines, vatRate, applyVat]);

  // The balance is the customer's, so it is read fresh whenever the customer changes.
  useEffect(() => {
    let live = true;
    const set = (n: number) => { if (live) setPoints(n); };
    if (!customerId || loyalty.redeemRate <= 0) Promise.resolve().then(() => set(0));
    else void getLoyaltyBalanceAction(customerId).then((r) => set(r.ok ? (r.points ?? 0) : 0)).catch(() => set(0));
    return () => { live = false; };
  }, [customerId, loyalty.redeemRate]);

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
    const add = (it: Awaited<ReturnType<typeof scanItemAction>>) => {
      if (!it) { toast.error(q.online ? "مفيش صنف بالكود ده" : "الصنف ده مش متخزّن على الجهاز — محتاج نت أول مرة"); return; }
      // Scanning the same barcode again bumps the line rather than adding a second one —
      // three of the same thing is one line with a 3 in it.
      setCart((c) => {
        const i = c.findIndex((x) => x.itemId === it.id);
        if (i >= 0) return c.map((x, k) => (k === i ? { ...x, quantity: x.quantity + 1 } : x));
        return [...c, { itemId: it.id, code: it.code, name: it.name || it.code, quantity: 1, unitPrice: Number(it.sellPrice) || 0, discount: 0 }];
      });
      scanRef.current?.focus();
    };

    if (!q.online) { add(cachedItem(code)); return; }
    void scanItemAction(code)
      .then((it) => { if (it) cacheItem(it); add(it); })
      // The network died between shifts of attention; fall back to what this device knows.
      .catch(() => add(cachedItem(code)));
  };

  const clearCart = () => {
    setCart([]);
    setPayments([{ method: "CASH", amount: 0 }]);
    setRedeem("");
    scanRef.current?.focus();
  };

  const ring = () =>
    void (async () => {
      if (!state?.shift) return;
      if (!cart.length) return toast.error("السلة فاضية");
      if (!customerId) return toast.error("اختر العميل");
      const paid = payments.filter((p) => p.amount > 0);
      const err = validatePayments(totals.total, paid);
      if (err) return toast.error(err);
      if (redeemPoints > 0) {
        const redeemErr = validateRedeem(redeemPoints, points, beforePoints, loyalty);
        if (redeemErr) return toast.error(redeemErr);
      }

      const sale = {
        clientRef: newClientRef(),
        soldAt: new Date().toISOString(),
        shiftId: state.shift.id,
        customerId,
        // Promoted lines, not raw ones: an offline sale must post at the price the
        // customer was quoted, even if the rules changed while the till was dark.
        lines: promo.lines.map((l, i) => ({ itemId: l.itemId, label: cart[i]?.name ?? "", quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount })),
        payments: paid.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference ?? null })),
        applyVat, vatRate, total: totals.total,
        status: "PENDING" as const, attempts: 0,
      };

      // Offline: the sale is real and the money is taken. Queue it and let the customer go.
      if (!q.online) {
        const blocked = canQueueOffline(sale);
        if (blocked) return toast.error(blocked);
        if (redeemPoints > 0) return toast.error("النقط محتاجة نت — رصيد العميل مش هيتخمّن");
        q.add(sale);
        toast.success(`اتسجّلت بدون نت — هتترحّل أول ما الشبكة ترجع${change > 0 ? ` · الفكة ${money(change)}` : ""}`);
        clearCart();
        return;
      }

      start(async () => {
        try {
          const r = await ringSaleAction({
            shiftId: sale.shiftId,
            customerId: sale.customerId,
            lines: sale.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount })),
            payments: sale.payments,
            applyVat, vatRate,
            clientRef: sale.clientRef, soldAt: sale.soldAt,
            redeemPoints,
          });
          if (!r.ok) { toast.error(r.error ?? "تعذّر إتمام البيع"); return; }
          toast.success(
            `${r.invoiceNumber}${r.change && r.change > 0 ? ` — الفكة ${money(r.change)}` : ""}`
            + (r.earnedPoints ? ` · +${r.earnedPoints} نقطة` : ""),
          );
          clearCart();
          load();
        } catch {
          // The request never landed. We do not know whether it posted — the clientRef
          // makes the replay safe either way, so the sale goes in the queue rather than
          // asking the cashier to ring it again.
          if (canQueueOffline(sale)) { toast.error("الشبكة وقعت والبيعة دي مينفعش تتأجّل — أعِد المحاولة"); return; }
          q.add(sale);
          toast.warning("الشبكة وقعت — البيعة اتحفظت وهتترحّل لوحدها");
          clearCart();
        }
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
  const queued = drawerAdjustment(q.queue);
  const unsettled = pendingSales(q.queue).length + failedSales(q.queue).length;
  // The drawer holds the offline takings too, even though the books have not seen them yet.
  const expectedCash = (r?.expected ?? 0) + queued.cash;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                وردية {state.shift.number}
                {!q.online && <Badge variant="destructive" className="gap-1"><Icon name="WifiOff" className="size-3" />بدون نت</Badge>}
                {q.syncing && <Badge variant="outline" className="gap-1"><Icon name="Loader2" className="size-3 animate-spin" />بيزامن</Badge>}
              </CardTitle>
              <CardDescription>
                {state.sales.length + unsettled} بيعة · إجمالي {money((r?.totalSales ?? 0) + queued.sales)} · كاش في الدرج (متوقّع) {money(expectedCash)}
                {unsettled > 0 && ` · ${unsettled} لسه ما اترحّلتش`}
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
              <Button onClick={close} disabled={pending || counted === "" || unsettled > 0}>
                <Icon name="Check" className="size-4" />اقفل
              </Button>
              <span className="pb-2 text-sm text-muted-foreground">
                المتوقّع {money(expectedCash)}
                {counted !== "" && ` · الفرق ${money((Number(counted) || 0) - expectedCash)}`}
              </span>
              {unsettled > 0 && (
                <span className="pb-2 text-sm font-medium text-destructive">
                  فيه {unsettled} بيعة لسه ما وصلتش للدفاتر — زامنها الأول، الوردية مبتتقفلش على فرق مش حقيقي.
                </span>
              )}
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
                          {money(l.quantity * l.unitPrice - (promo.lines[i]?.discount ?? l.discount ?? 0))}
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

            {canRedeem && customerId && (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">رصيد النقط</span>
                  <span className="font-medium tabular-nums">{points} نقطة · {money(pointsValue(points, loyalty))}</span>
                </div>
                {maxRedeemable(points, beforePoints, loyalty) > 0 && (
                  <div className="flex gap-2">
                    <Input type="number" step="1" min="0" className="tabular-nums" placeholder="استبدل نقط"
                      value={redeem} onChange={(e) => setRedeem(e.target.value)} />
                    <Button size="sm" variant="outline"
                      onClick={() => setRedeem(String(maxRedeemable(points, beforePoints, loyalty)))}>
                      الأقصى
                    </Button>
                  </div>
                )}
                {redeemPoints > 0 && validateRedeem(redeemPoints, points, beforePoints, loyalty) && (
                  <p className="text-xs text-destructive">{validateRedeem(redeemPoints, points, beforePoints, loyalty)}</p>
                )}
              </div>
            )}

            <div className="space-y-1 rounded-lg border p-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">الإجمالي</span><span className="tabular-nums">{money(totals.subtotal)}</span></div>
              {totals.discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">الخصم</span><span className="tabular-nums">−{money(totals.discount)}</span></div>}
              {promo.applied.map((a) => (
                <div key={a.promotionId} className="flex justify-between text-emerald-600">
                  <span>{a.nameAr}</span><span className="tabular-nums">−{money(a.amount)}</span>
                </div>
              ))}
              {redeemAmount > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>{redeemPoints} نقطة</span><span className="tabular-nums">−{money(redeemAmount)}</span>
                </div>
              )}
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

      {q.queue.some((x) => x.status !== "SYNCED") && (
        <Card className={failedSales(q.queue).length > 0 ? "border-destructive/50" : undefined}>
          <CardHeader>
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>بيعات لسه ما اترحّلتش</CardTitle>
                <CardDescription>
                  الفلوس اتاخدت والبضاعة مشيت. البيعة بتفضل هنا لحد ما تترحّل — ولا بتتشال لوحدها أبداً.
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" disabled={!q.online || q.syncing}
                onClick={() => void q.sync().then((res) => {
                  if (res.failed > 0) toast.error(`${res.failed} بيعة اترفضت — شوف السبب تحت`);
                  else if (res.done > 0) { toast.success(`اترحّلت ${res.done} بيعة`); load(); }
                })}>
                <Icon name="RefreshCw" className={`size-4 ${q.syncing ? "animate-spin" : ""}`} />زامن دلوقتي
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">وقت البيع</TableHead>
                    <TableHead className="text-start">الأصناف</TableHead>
                    <TableHead className="text-start">الإجمالي</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.queue.filter((x) => x.status !== "SYNCED").map((x) => (
                    <TableRow key={x.clientRef}>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">
                        {new Date(x.soldAt).toLocaleString("ar-EG-u-nu-latn", { dateStyle: "short", timeStyle: "short" })}
                      </TableCell>
                      <TableCell className="text-sm">{x.lines.map((l) => `${l.label} ×${l.quantity}`).join(" · ")}</TableCell>
                      <TableCell className="font-medium tabular-nums">{money(x.total)}</TableCell>
                      <TableCell>
                        {x.status === "FAILED"
                          ? <span className="text-sm text-destructive">{x.error}</span>
                          : <Badge variant="outline">في الطابور</Badge>}
                      </TableCell>
                      <TableCell>
                        {x.status === "FAILED" && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => { q.retry(x.clientRef); void q.sync().then(() => load()); }}>
                              أعِد المحاولة
                            </Button>
                            <Button size="sm" variant="ghost" aria-label="إلغاء" onClick={() => void (async () => {
                              const go = await confirm({
                                danger: true,
                                title: "تلغي البيعة دي نهائياً؟",
                                description: `${money(x.total)} اتاخدوا فعلاً من العميل. لو مسحتها من غير ما ترحّلها، الفلوس دي هتفضل في الدرج من غير فاتورة ومحدش هيعرف مصدرها.`,
                                confirmText: "امسحها", cancelText: "رجوع",
                              });
                              if (go) q.discard(x.clientRef);
                            })()}>
                              <Icon name="X" className="size-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

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
