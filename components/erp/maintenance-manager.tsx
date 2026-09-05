"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  saveAssetOpsAction, recordMeterAction, savePlanAction, deletePlanAction,
  createWorkOrderAction, addWorkOrderPartAction, removeWorkOrderPartAction,
  startWorkOrderAction, completeWorkOrderAction, cancelWorkOrderAction,
} from "@/app/actions/erp/maintenance";
import { nextDue, mttr, mtbf, workOrderCost, METER_LABEL, type MeterType, type MaintenancePlan } from "@/lib/erp/maintenance";
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

export type AssetRow = {
  id: string; code: string; nameAr: string; category: string;
  meterType: MeterType; currentMeter: number | null; isDown: boolean;
  plateNumber: string | null; licenseExpiry: string | null; insuranceExpiry: string | null;
  driverEmployeeId: string | null;
};
export type PlanRow = MaintenancePlan & { assetId: string };
export type PartRow = { id: string; itemId: string; itemLabel: string; warehouseId: string; warehouseLabel: string; quantity: number; unitCost: number; issued: boolean };
export type WorkOrderRow = {
  id: string; number: string; assetId: string; assetName: string; planId: string | null;
  type: "PREVENTIVE" | "CORRECTIVE"; status: "DRAFT" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  reportedAt: string; completedAt: string | null; description: string;
  assignedTo: string | null; assignedName: string | null; warehouseId: string | null;
  laborHours: number; laborRate: number; downtimeHours: number; partsCost: number;
  parts: PartRow[];
};
export type Option = { id: string; label: string };

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });

const STATUS: Record<WorkOrderRow["status"], { label: string; cls?: string }> = {
  DRAFT: { label: "مفتوح" },
  IN_PROGRESS: { label: "شغّال", cls: "bg-amber-600" },
  DONE: { label: "مقفول", cls: "bg-emerald-600" },
  CANCELLED: { label: "ملغي" },
};

/**
 * Maintenance: what is due, what is being worked on, and what each machine has cost.
 * The asset list is the fixed-asset register — the same rows the ledger depreciates.
 */
export function MaintenanceManager({ assets, plans, orders, items, warehouses, technicians, canManage, fleetOnly = false }: {
  assets: AssetRow[]; plans: PlanRow[]; orders: WorkOrderRow[];
  items: Option[]; warehouses: Option[]; technicians: Option[];
  canManage: boolean;
  /** The fleet page reuses this for its work orders and hides the workshop framing. */
  fleetOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"due" | "orders" | "plans" | "assets">("due");
  const [woForm, setWoForm] = useState<{ assetId: string; planId: string; type: "PREVENTIVE" | "CORRECTIVE"; description: string; assignedTo: string; warehouseId: string } | null>(null);
  const [planForm, setPlanForm] = useState<{ id?: string; assetId: string; nameAr: string; everyDays: string; everyMeter: string; lastDoneAt: string; lastDoneMeter: string; isActive: boolean } | null>(null);
  const [partFor, setPartFor] = useState<string | null>(null);
  const [part, setPart] = useState({ itemId: "", warehouseId: warehouses[0]?.id ?? "", quantity: "1" });
  const [closeFor, setCloseFor] = useState<string | null>(null);
  const [closeForm, setCloseForm] = useState({ laborHours: "", laborRate: "", downtimeHours: "", meterAtWork: "" });
  const [meterFor, setMeterFor] = useState<string | null>(null);
  const [meterValue, setMeterValue] = useState("");
  const [opsFor, setOpsFor] = useState<AssetRow | null>(null);

  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  // What is due right now, worst first. This is the whole point of the screen.
  const due = useMemo(() => {
    const rows = plans
      .filter((p) => p.isActive)
      .map((p) => {
        const asset = assetById.get(p.assetId);
        const status = nextDue(p, { currentMeter: asset?.currentMeter ?? null });
        return { plan: p, asset, status };
      })
      .filter((r) => r.asset && r.status.isDue);
    return rows.sort((a, b) => (b.status.daysLate ?? 0) - (a.status.daysLate ?? 0));
  }, [plans, assetById]);

  const openOrders = orders.filter((o) => o.status === "DRAFT" || o.status === "IN_PROGRESS");
  const doneOrders = orders.filter((o) => o.status === "DONE");

  const reliability = useMemo(() => {
    const corrective = orders
      .filter((o) => o.type === "CORRECTIVE" && o.status !== "CANCELLED")
      .map((o) => ({ reportedAt: o.reportedAt, completedAt: o.completedAt, downtimeHours: o.downtimeHours }));
    return { mttr: mttr(corrective), mtbf: mtbf(corrective), failures: corrective.length };
  }, [orders]);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, good: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(good); router.refresh(); }
      else toast.error(r.error ?? "تعذّرت العملية");
    });

  const openWorkOrder = (assetId: string, planId?: string, description?: string) => {
    setTab("orders");
    setWoForm({
      assetId, planId: planId ?? "",
      type: planId ? "PREVENTIVE" : "CORRECTIVE",
      description: description ?? "",
      assignedTo: "", warehouseId: warehouses[0]?.id ?? "",
    });
  };

  const TABS: { key: typeof tab; label: string; count?: number }[] = [
    { key: "due", label: "المستحق", count: due.length },
    { key: "orders", label: "أوامر الشغل", count: openOrders.length },
    { key: "plans", label: "الخطط", count: plans.filter((p) => p.isActive).length },
    { key: "assets", label: fleetOnly ? "السيارات" : "الأصول", count: assets.length },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">مستحق دلوقتي</div>
          <div className={`text-2xl font-bold tabular-nums ${due.length ? "text-destructive" : ""}`}>{due.length}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">متوسط زمن الإصلاح</div>
          <div className="text-2xl font-bold tabular-nums">
            {reliability.mttr == null ? "—" : `${num(reliability.mttr)} س`}
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">متوسط الزمن بين الأعطال</div>
          <div className="text-2xl font-bold tabular-nums">
            {reliability.mtbf == null ? "—" : `${num(reliability.mtbf)} س`}
          </div>
          {reliability.mtbf == null && reliability.failures < 2 && (
            <div className="text-xs text-muted-foreground">محتاج عطلين على الأقل عشان يبقى ليه معنى</div>
          )}
        </CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button key={t.key} size="sm" variant={tab === t.key ? "default" : "outline"} onClick={() => setTab(t.key)}>
            {t.label}{t.count != null && ` (${t.count})`}
          </Button>
        ))}
      </div>

      {/* ── due ───────────────────────────────────────────────────── */}
      {tab === "due" && (
        <Card>
          <CardHeader>
            <CardTitle>الصيانة المستحقة</CardTitle>
            <CardDescription>
              بالوقت أو بالاستخدام — اللي يوصل الأول. الخطة اللي لسه ما اتعملتش ولا مرة بتظهر هنا من يومها.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {due.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش حاجة مستحقة. لو الجدول فاضي وانت متوقّع حاجة، راجع الخطط.</p>
            ) : (
              <div className="rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">{fleetOnly ? "السيارة" : "الأصل"}</TableHead>
                      <TableHead className="text-start">الخطة</TableHead>
                      <TableHead className="text-start">السبب</TableHead>
                      <TableHead className="text-start">العدّاد</TableHead>
                      <TableHead className="w-32" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {due.map(({ plan, asset, status }) => (
                      <TableRow key={plan.id}>
                        <TableCell>
                          <div className="font-medium">{asset!.nameAr}</div>
                          <div className="font-mono text-xs text-muted-foreground">{asset!.plateNumber ?? asset!.code}</div>
                        </TableCell>
                        <TableCell>{plan.nameAr}</TableCell>
                        <TableCell className="text-sm text-destructive">{status.reason}</TableCell>
                        <TableCell className="tabular-nums text-sm">
                          {asset!.currentMeter == null ? "—" : `${num(asset!.currentMeter)} ${METER_LABEL[asset!.meterType]}`}
                        </TableCell>
                        <TableCell>
                          {canManage && (
                            <Button size="sm" onClick={() => openWorkOrder(plan.assetId, plan.id, plan.nameAr)}>
                              افتح أمر شغل
                            </Button>
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
      )}

      {/* ── work orders ───────────────────────────────────────────── */}
      {tab === "orders" && (
        <Card>
          <CardHeader>
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>أوامر الشغل</CardTitle>
                <CardDescription>
                  القطع بتخرج من المخزن وقت الإقفال، وبتترحّل على مصروف الصيانة. ساعات العمالة بتتسجّل للتكلفة بس —
                  الأجر اتحسب في المرتبات خلاص.
                </CardDescription>
              </div>
              {canManage && (
                <Button size="sm" onClick={() => openWorkOrder(assets[0]?.id ?? "")} disabled={assets.length === 0}>
                  <Icon name="Plus" className="size-4" />أمر شغل
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {woForm && (
              <div className="space-y-3 rounded-xl border p-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <Label>{fleetOnly ? "السيارة" : "الأصل"}</Label>
                    <CellCombobox
                      selectedLabel={assetById.get(woForm.assetId)?.nameAr ?? ""}
                      options={assets.map((a) => ({ id: a.id, label: `${a.code} — ${a.nameAr}` }))}
                      onSelect={(id) => setWoForm((f) => (f ? { ...f, assetId: id } : f))}
                      placeholder="اختر…"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>النوع</Label>
                    <select className={selectCls} value={woForm.type}
                      onChange={(e) => setWoForm((f) => (f ? { ...f, type: e.target.value as "PREVENTIVE" | "CORRECTIVE" } : f))}>
                      <option value="CORRECTIVE">عطل</option>
                      <option value="PREVENTIVE">صيانة دورية</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>الفني</Label>
                    <CellCombobox
                      selectedLabel={technicians.find((t) => t.id === woForm.assignedTo)?.label ?? ""}
                      options={technicians}
                      onSelect={(id) => setWoForm((f) => (f ? { ...f, assignedTo: id } : f))}
                      placeholder="اختياري"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>مخزن قطع الغيار</Label>
                    <select className={selectCls} value={woForm.warehouseId}
                      onChange={(e) => setWoForm((f) => (f ? { ...f, warehouseId: e.target.value } : f))}>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2 sm:col-span-2 lg:col-span-4">
                    <Label>المشكلة أو الشغل المطلوب</Label>
                    <Input value={woForm.description} autoFocus placeholder="صوت غريب من الفرامل"
                      onChange={(e) => setWoForm((f) => (f ? { ...f, description: e.target.value } : f))} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button disabled={pending || !woForm.assetId || !woForm.description.trim()}
                    onClick={() => run(async () => {
                      const r = await createWorkOrderAction({
                        assetId: woForm.assetId, planId: woForm.planId || null, type: woForm.type,
                        description: woForm.description, assignedTo: woForm.assignedTo || null,
                        warehouseId: woForm.warehouseId || null,
                      });
                      if (r.ok) setWoForm(null);
                      return r;
                    }, "اتفتح أمر شغل")}>
                    <Icon name="Check" className="size-4" />افتح
                  </Button>
                  <Button variant="ghost" onClick={() => setWoForm(null)}>رجوع</Button>
                </div>
              </div>
            )}

            {orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش أوامر شغل.</p>
            ) : (
              <div className="space-y-3">
                {[...openOrders, ...orders.filter((o) => o.status === "CANCELLED"), ...doneOrders].map((o) => (
                  <div key={o.id} className="space-y-3 rounded-xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{o.number}</span>
                          <Badge className={STATUS[o.status].cls} variant={STATUS[o.status].cls ? undefined : "outline"}>
                            {STATUS[o.status].label}
                          </Badge>
                          <Badge variant="outline">{o.type === "PREVENTIVE" ? "دورية" : "عطل"}</Badge>
                        </div>
                        <div className="mt-1 font-medium">{o.assetName} — {o.description}</div>
                        <div className="text-xs text-muted-foreground">
                          بلاغ {o.reportedAt}
                          {o.assignedName && ` · ${o.assignedName}`}
                          {o.status === "DONE" && ` · قطع ${money(o.partsCost)} · إجمالي ${money(workOrderCost({ parts: [], laborHours: o.laborHours, laborRate: o.laborRate }).labor + o.partsCost)}`}
                        </div>
                      </div>
                      {canManage && o.status !== "DONE" && o.status !== "CANCELLED" && (
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="outline" onClick={() => { setPartFor(partFor === o.id ? null : o.id); setPart((p) => ({ ...p, warehouseId: o.warehouseId ?? p.warehouseId })); }}>
                            <Icon name="Plus" className="size-4" />قطعة
                          </Button>
                          {o.status === "DRAFT" && (
                            <Button size="sm" variant="outline" onClick={() => run(() => startWorkOrderAction(o.id), "بدأ الشغل")}>
                              ابدأ
                            </Button>
                          )}
                          <Button size="sm" onClick={() => { setCloseFor(closeFor === o.id ? null : o.id); setCloseForm({ laborHours: "", laborRate: "", downtimeHours: "", meterAtWork: "" }); }}>
                            اقفل
                          </Button>
                          <Button size="sm" variant="ghost" aria-label="إلغاء" onClick={() => void (async () => {
                            const go = await confirm({
                              danger: true, title: `تلغي ${o.number}؟`,
                              description: "الأمر هيفضل في السجل كملغي. القطع اللي لسه ما اتصرفتش مش هتخرج من المخزن.",
                              confirmText: "الغِ", cancelText: "رجوع",
                            });
                            if (go) run(() => cancelWorkOrderAction(o.id), "اتلغى");
                          })()}>
                            <Icon name="X" className="size-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {o.parts.length > 0 && (
                      <div className="rounded-lg border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-start">القطعة</TableHead>
                              <TableHead className="text-start">المخزن</TableHead>
                              <TableHead className="w-24 text-start">الكمية</TableHead>
                              <TableHead className="text-start">التكلفة</TableHead>
                              <TableHead className="w-10" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {o.parts.map((p) => (
                              <TableRow key={p.id}>
                                <TableCell className="text-sm">{p.itemLabel}</TableCell>
                                <TableCell className="text-sm">{p.warehouseLabel}</TableCell>
                                <TableCell className="tabular-nums">{num(p.quantity)}</TableCell>
                                <TableCell className="tabular-nums">
                                  {p.issued ? money(p.quantity * p.unitCost) : <span className="text-xs text-muted-foreground">لسه ما اتصرفتش</span>}
                                </TableCell>
                                <TableCell>
                                  {canManage && !p.issued && (
                                    <Button size="icon" variant="ghost" aria-label="شيل"
                                      onClick={() => run(() => removeWorkOrderPartAction(p.id), "اتشالت")}>
                                      <Icon name="X" className="size-4 text-destructive" />
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    {partFor === o.id && (
                      <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
                        <div className="w-64 space-y-2">
                          <Label>القطعة</Label>
                          <CellCombobox
                            selectedLabel={items.find((i) => i.id === part.itemId)?.label ?? ""}
                            options={items} onSelect={(id) => setPart((p) => ({ ...p, itemId: id }))}
                            placeholder="ابحث…"
                          />
                        </div>
                        <div className="space-y-2"><Label>المخزن</Label>
                          <select className={`${selectCls} w-44`} value={part.warehouseId}
                            onChange={(e) => setPart((p) => ({ ...p, warehouseId: e.target.value }))}>
                            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                          </select></div>
                        <div className="space-y-2"><Label>الكمية</Label>
                          <Input type="number" step="any" min="0" className="w-24 tabular-nums" value={part.quantity}
                            onChange={(e) => setPart((p) => ({ ...p, quantity: e.target.value }))} /></div>
                        <Button disabled={pending || !part.itemId || !part.warehouseId}
                          onClick={() => run(async () => {
                            const r = await addWorkOrderPartAction({
                              workOrderId: o.id, itemId: part.itemId, warehouseId: part.warehouseId,
                              quantity: Number(part.quantity) || 0,
                            });
                            if (r.ok) setPart((p) => ({ ...p, itemId: "", quantity: "1" }));
                            return r;
                          }, "اتضافت")}>
                          ضيف
                        </Button>
                      </div>
                    )}

                    {closeFor === o.id && (
                      <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
                        <div className="space-y-2"><Label>ساعات العمل</Label>
                          <Input type="number" step="0.5" min="0" className="w-24 tabular-nums" value={closeForm.laborHours}
                            onChange={(e) => setCloseForm((f) => ({ ...f, laborHours: e.target.value }))} /></div>
                        <div className="space-y-2"><Label>أجر الساعة</Label>
                          <Input type="number" step="0.01" min="0" className="w-28 tabular-nums" value={closeForm.laborRate}
                            onChange={(e) => setCloseForm((f) => ({ ...f, laborRate: e.target.value }))} /></div>
                        <div className="space-y-2"><Label>ساعات التوقف</Label>
                          <Input type="number" step="0.5" min="0" className="w-28 tabular-nums" value={closeForm.downtimeHours}
                            onChange={(e) => setCloseForm((f) => ({ ...f, downtimeHours: e.target.value }))} /></div>
                        {assetById.get(o.assetId)?.meterType !== "NONE" && (
                          <div className="space-y-2"><Label>قراءة العدّاد</Label>
                            <Input type="number" step="any" min="0" className="w-32 tabular-nums" value={closeForm.meterAtWork}
                              onChange={(e) => setCloseForm((f) => ({ ...f, meterAtWork: e.target.value }))} /></div>
                        )}
                        <Button disabled={pending} onClick={() => void (async () => {
                          const go = await confirm({
                            title: `تقفل ${o.number}؟`,
                            description: o.parts.length
                              ? `${o.parts.length} قطعة هتخرج من المخزن دلوقتي وتترحّل على مصروف الصيانة. الخروج ده مبيترجعش بضغطة.`
                              : "مفيش قطع على الأمر ده، فمفيش قيد هيتعمل.",
                            confirmText: "اقفل", cancelText: "رجوع",
                          });
                          if (!go) return;
                          run(async () => {
                            const r = await completeWorkOrderAction({
                              id: o.id,
                              laborHours: Number(closeForm.laborHours) || 0,
                              laborRate: Number(closeForm.laborRate) || 0,
                              downtimeHours: Number(closeForm.downtimeHours) || 0,
                              meterAtWork: closeForm.meterAtWork === "" ? null : Number(closeForm.meterAtWork),
                            });
                            if (r.ok) setCloseFor(null);
                            return r;
                          }, "اتقفل");
                        })()}>
                          <Icon name="Check" className="size-4" />اقفل الأمر
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── plans ─────────────────────────────────────────────────── */}
      {tab === "plans" && (
        <Card>
          <CardHeader>
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>خطط الصيانة الوقائية</CardTitle>
                <CardDescription>كل كام يوم، أو كل كام {fleetOnly ? "كيلومتر" : "ساعة"} — أو الاتنين واللي يوصل الأول.</CardDescription>
              </div>
              {canManage && (
                <Button size="sm" disabled={assets.length === 0}
                  onClick={() => setPlanForm({ assetId: assets[0]?.id ?? "", nameAr: "", everyDays: "", everyMeter: "", lastDoneAt: "", lastDoneMeter: "", isActive: true })}>
                  <Icon name="Plus" className="size-4" />خطة
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {planForm && (
              <div className="space-y-3 rounded-xl border p-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-2">
                    <Label>{fleetOnly ? "السيارة" : "الأصل"}</Label>
                    <CellCombobox
                      selectedLabel={assetById.get(planForm.assetId)?.nameAr ?? ""}
                      options={assets.map((a) => ({ id: a.id, label: `${a.code} — ${a.nameAr}` }))}
                      onSelect={(id) => setPlanForm((f) => (f ? { ...f, assetId: id } : f))}
                      placeholder="اختر…"
                    />
                  </div>
                  <div className="space-y-2"><Label>اسم الخطة</Label>
                    <Input value={planForm.nameAr} placeholder="تغيير زيت"
                      onChange={(e) => setPlanForm((f) => (f ? { ...f, nameAr: e.target.value } : f))} /></div>
                  <div className="space-y-2"><Label>كل كام يوم</Label>
                    <Input type="number" step="1" min="0" value={planForm.everyDays}
                      onChange={(e) => setPlanForm((f) => (f ? { ...f, everyDays: e.target.value } : f))} /></div>
                  <div className="space-y-2"><Label>كل كام وحدة عدّاد</Label>
                    <Input type="number" step="any" min="0" value={planForm.everyMeter}
                      onChange={(e) => setPlanForm((f) => (f ? { ...f, everyMeter: e.target.value } : f))} /></div>
                  <div className="space-y-2"><Label>آخر مرة اتعملت</Label>
                    <Input type="date" value={planForm.lastDoneAt}
                      onChange={(e) => setPlanForm((f) => (f ? { ...f, lastDoneAt: e.target.value } : f))} /></div>
                  <div className="space-y-2"><Label>العدّاد وقتها</Label>
                    <Input type="number" step="any" min="0" value={planForm.lastDoneMeter}
                      onChange={(e) => setPlanForm((f) => (f ? { ...f, lastDoneMeter: e.target.value } : f))} /></div>
                </div>
                <div className="flex gap-2">
                  <Button disabled={pending || !planForm.assetId || !planForm.nameAr.trim()}
                    onClick={() => run(async () => {
                      const r = await savePlanAction({
                        id: planForm.id, assetId: planForm.assetId, nameAr: planForm.nameAr,
                        everyDays: Number(planForm.everyDays) || 0, everyMeter: Number(planForm.everyMeter) || 0,
                        lastDoneAt: planForm.lastDoneAt || null,
                        lastDoneMeter: planForm.lastDoneMeter === "" ? null : Number(planForm.lastDoneMeter),
                        isActive: planForm.isActive,
                      });
                      if (r.ok) setPlanForm(null);
                      return r;
                    }, "اتحفظت")}>
                    <Icon name="Check" className="size-4" />احفظ
                  </Button>
                  <Button variant="ghost" onClick={() => setPlanForm(null)}>رجوع</Button>
                </div>
              </div>
            )}

            {plans.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش خطط. من غيرها الصيانة بتفضل رد فعل على العطل.</p>
            ) : (
              <div className="rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">{fleetOnly ? "السيارة" : "الأصل"}</TableHead>
                      <TableHead className="text-start">الخطة</TableHead>
                      <TableHead className="text-start">كل</TableHead>
                      <TableHead className="text-start">الحالة</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plans.map((p) => {
                      const asset = assetById.get(p.assetId);
                      const status = nextDue(p, { currentMeter: asset?.currentMeter ?? null });
                      return (
                        <TableRow key={p.id}>
                          <TableCell>{asset?.nameAr ?? "—"}</TableCell>
                          <TableCell className="font-medium">{p.nameAr}</TableCell>
                          <TableCell className="text-sm">
                            {[p.everyDays > 0 ? `${p.everyDays} يوم` : null, p.everyMeter > 0 ? `${num(p.everyMeter)} ${asset ? METER_LABEL[asset.meterType] : ""}` : null]
                              .filter(Boolean).join(" أو ")}
                          </TableCell>
                          <TableCell className="text-sm">
                            {!p.isActive ? <Badge variant="outline">موقوفة</Badge>
                              : status.isDue ? <span className="text-destructive">{status.reason}</span>
                              : <span className="text-muted-foreground">{status.reason}</span>}
                          </TableCell>
                          <TableCell>
                            {canManage && (
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" aria-label="تعديل" onClick={() => setPlanForm({
                                  id: p.id, assetId: p.assetId, nameAr: p.nameAr,
                                  everyDays: String(p.everyDays), everyMeter: String(p.everyMeter),
                                  lastDoneAt: p.lastDoneAt?.slice(0, 10) ?? "",
                                  lastDoneMeter: p.lastDoneMeter == null ? "" : String(p.lastDoneMeter),
                                  isActive: p.isActive,
                                })}>
                                  <Icon name="Edit" className="size-4" />
                                </Button>
                                <Button size="icon" variant="ghost" aria-label="مسح"
                                  onClick={() => void (async () => {
                                    const go = await confirm({
                                      danger: true, title: `تمسح «${p.nameAr}»؟`,
                                      description: "لو ليها أوامر شغل قديمة هتتوقف بس — التاريخ مبيتمسحش.",
                                      confirmText: "امسح", cancelText: "رجوع",
                                    });
                                    if (go) run(() => deletePlanAction(p.id), "خلاص");
                                  })()}>
                                  <Icon name="Trash2" className="size-4 text-destructive" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── assets ────────────────────────────────────────────────── */}
      {tab === "assets" && (
        <Card>
          <CardHeader>
            <CardTitle>{fleetOnly ? "السيارات" : "الأصول"}</CardTitle>
            <CardDescription>
              دي نفس أصول دفتر الأصول الثابتة — الآلة اللي في الورشة والآلة اللي في الدفاتر واحدة.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {opsFor && (
              <div className="space-y-3 rounded-xl border p-4">
                <div className="font-medium">{opsFor.nameAr}</div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2"><Label>نوع العدّاد</Label>
                    <select className={selectCls} defaultValue={opsFor.meterType} id="ops-meter">
                      {(Object.keys(METER_LABEL) as MeterType[]).map((m) => (
                        <option key={m} value={m}>{METER_LABEL[m]}</option>
                      ))}
                    </select></div>
                  <div className="space-y-2"><Label>رقم اللوحة</Label>
                    <Input defaultValue={opsFor.plateNumber ?? ""} id="ops-plate" /></div>
                  <div className="space-y-2"><Label>انتهاء الرخصة</Label>
                    <Input type="date" defaultValue={opsFor.licenseExpiry ?? ""} id="ops-license" /></div>
                  <div className="space-y-2"><Label>انتهاء التأمين</Label>
                    <Input type="date" defaultValue={opsFor.insuranceExpiry ?? ""} id="ops-insurance" /></div>
                </div>
                <div className="flex gap-2">
                  <Button disabled={pending} onClick={() => run(async () => {
                    const g = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
                    const r = await saveAssetOpsAction({
                      assetId: opsFor.id, meterType: g("ops-meter") as MeterType,
                      plateNumber: g("ops-plate") || null,
                      licenseExpiry: g("ops-license") || null,
                      insuranceExpiry: g("ops-insurance") || null,
                      driverEmployeeId: opsFor.driverEmployeeId,
                    });
                    if (r.ok) setOpsFor(null);
                    return r;
                  }, "اتحفظ")}>
                    <Icon name="Check" className="size-4" />احفظ
                  </Button>
                  <Button variant="ghost" onClick={() => setOpsFor(null)}>رجوع</Button>
                </div>
              </div>
            )}

            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الكود</TableHead>
                    <TableHead className="text-start">الاسم</TableHead>
                    <TableHead className="text-start">العدّاد</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                    <TableHead className="w-56" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-xs">{a.plateNumber ?? a.code}</TableCell>
                      <TableCell className="font-medium">{a.nameAr}</TableCell>
                      <TableCell className="tabular-nums text-sm">
                        {a.meterType === "NONE" ? "—" : `${a.currentMeter == null ? "?" : num(a.currentMeter)} ${METER_LABEL[a.meterType]}`}
                      </TableCell>
                      <TableCell>
                        {a.isDown ? <Badge variant="destructive">واقف للصيانة</Badge> : <Badge variant="outline">شغّال</Badge>}
                      </TableCell>
                      <TableCell>
                        {canManage && (
                          <div className="flex flex-wrap gap-1">
                            {a.meterType !== "NONE" && (
                              meterFor === a.id ? (
                                <div className="flex gap-1">
                                  <Input type="number" step="any" min="0" className="w-28 tabular-nums" autoFocus
                                    value={meterValue} onChange={(e) => setMeterValue(e.target.value)} />
                                  <Button size="sm" disabled={pending || meterValue === ""}
                                    onClick={() => run(async () => {
                                      const r = await recordMeterAction({ assetId: a.id, value: Number(meterValue) });
                                      if (r.ok) { setMeterFor(null); setMeterValue(""); }
                                      return r;
                                    }, "اتسجّلت")}>
                                    <Icon name="Check" className="size-4" />
                                  </Button>
                                </div>
                              ) : (
                                <Button size="sm" variant="outline" onClick={() => { setMeterFor(a.id); setMeterValue(""); }}>
                                  قراءة عدّاد
                                </Button>
                              )
                            )}
                            <Button size="sm" variant="ghost" onClick={() => setOpsFor(a)}>
                              <Icon name="Edit" className="size-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openWorkOrder(a.id)}>بلاغ عطل</Button>
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
    </div>
  );
}
