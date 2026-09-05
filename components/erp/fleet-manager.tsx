"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { logFuelAction, deleteFuelLogAction, saveTripAction, deleteTripAction } from "@/app/actions/erp/fleet";
import { consumption, fuelOutliers, tripDistance, type FuelLog } from "@/lib/erp/fleet";
import { expiringSoon, METER_LABEL } from "@/lib/erp/maintenance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { CellCombobox } from "@/components/erp/cell-combobox";
import type { AssetRow, Option } from "@/components/erp/maintenance-manager";

export type FuelRow = FuelLog & { assetId: string; assetName: string; station: string | null; driverName: string | null };
export type TripRow = {
  id: string; assetId: string; assetName: string; driverEmployeeId: string | null; driverName: string | null;
  startedAt: string; endedAt: string | null; startMeter: number; endMeter: number | null; purpose: string | null;
};
export type EconomyRow = {
  assetId: string; assetName: string; plateNumber: string | null;
  distance: number; liters: number; fuelCost: number; maintenanceCost: number; depreciation: number;
  per100: number | null; perKm: number; outliers: number;
};

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The fleet: papers about to run out, what a kilometre costs, and the fills that burned
 * more than they should have. Work orders live on the maintenance screen — same engine.
 */
export function FleetManager({ vehicles, fuel, trips, economy, drivers, canManage }: {
  vehicles: AssetRow[]; fuel: FuelRow[]; trips: TripRow[]; economy: EconomyRow[];
  drivers: Option[]; canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"economy" | "fuel" | "trips">("economy");
  const [fuelForm, setFuelForm] = useState<{ assetId: string; filledAt: string; liters: string; cost: string; meterValue: string; station: string; driverEmployeeId: string } | null>(null);
  const [tripForm, setTripForm] = useState<{ id?: string; assetId: string; driverEmployeeId: string; startedAt: string; endedAt: string; startMeter: string; endMeter: string; purpose: string } | null>(null);

  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);

  // Papers first: a truck with a lapsed licence is not a reporting problem, it is a
  // truck that must not leave the yard.
  const expiries = useMemo(() => expiringSoon(
    vehicles.flatMap((v) => [
      { id: `${v.id}-lic`, label: `${v.nameAr} — ${v.plateNumber ?? v.code}`, kind: "رخصة", expiresAt: v.licenseExpiry },
      { id: `${v.id}-ins`, label: `${v.nameAr} — ${v.plateNumber ?? v.code}`, kind: "تأمين", expiresAt: v.insuranceExpiry },
    ]),
    45,
  ), [vehicles]);

  const outlierIds = useMemo(() => {
    const ids = new Set<string>();
    for (const v of vehicles) {
      const rows = consumption(fuel.filter((f) => f.assetId === v.id));
      for (const o of fuelOutliers(rows)) ids.add(o.logId);
    }
    return ids;
  }, [vehicles, fuel]);

  const openTrips = trips.filter((t) => t.endMeter == null);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, good: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(good); router.refresh(); }
      else toast.error(r.error ?? "تعذّرت العملية");
    });

  return (
    <div className="space-y-6">
      {expiries.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle>ورق قرب يخلص</CardTitle>
            <CardDescription>اللي خلص فوق اللي قرب — عربية برخصة منتهية مش «قربت تبقى مشكلة».</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {expiries.map((e) => (
                <Badge key={e.id} variant={e.expired ? "destructive" : "outline"}>
                  {e.kind} · {e.label} · {e.expired ? `منتهية من ${-e.daysLeft} يوم` : `فاضل ${e.daysLeft} يوم`}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {([
          { key: "economy" as const, label: "التكلفة", count: economy.length },
          { key: "fuel" as const, label: "الوقود", count: fuel.length },
          { key: "trips" as const, label: "الرحلات", count: openTrips.length },
        ]).map((t) => (
          <Button key={t.key} size="sm" variant={tab === t.key ? "default" : "outline"} onClick={() => setTab(t.key)}>
            {t.label} ({t.count})
          </Button>
        ))}
      </div>

      {tab === "economy" && (
        <Card>
          <CardHeader>
            <CardTitle>تكلفة الكيلومتر</CardTitle>
            <CardDescription>
              وقود وصيانة وإهلاك. الإهلاك مضمون عن قصد — من غيره العربية القديمة بتبان رخيصة وهي مش رخيصة.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {economy.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش بيانات كفاية. محتاج تعبئتين وقود على الأقل بقراءة عدّاد.</p>
            ) : (
              <div className="rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">العربية</TableHead>
                      <TableHead className="text-start">المسافة</TableHead>
                      <TableHead className="text-start">لتر/١٠٠كم</TableHead>
                      <TableHead className="text-start">وقود</TableHead>
                      <TableHead className="text-start">صيانة</TableHead>
                      <TableHead className="text-start">إهلاك</TableHead>
                      <TableHead className="text-start">تكلفة الكم</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {economy.map((e) => (
                      <TableRow key={e.assetId}>
                        <TableCell>
                          <div className="font-medium">{e.assetName}</div>
                          <div className="font-mono text-xs text-muted-foreground">{e.plateNumber ?? "—"}</div>
                          {e.outliers > 0 && (
                            <Badge variant="destructive" className="mt-1">{e.outliers} تعبئة شاذة</Badge>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">{num(e.distance)}</TableCell>
                        <TableCell className="tabular-nums">{e.per100 == null ? "—" : num(e.per100)}</TableCell>
                        <TableCell className="tabular-nums">{money(e.fuelCost)}</TableCell>
                        <TableCell className="tabular-nums">{money(e.maintenanceCost)}</TableCell>
                        <TableCell className="tabular-nums">{money(e.depreciation)}</TableCell>
                        <TableCell className="font-bold tabular-nums">{money(e.perKm)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "fuel" && (
        <Card>
          <CardHeader>
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>الوقود</CardTitle>
                <CardDescription>
                  اكتب قراءة العدّاد عند الطلمبة — من غيرها اللترات مبتقولش حاجة عن الاستهلاك.
                </CardDescription>
              </div>
              {canManage && (
                <Button size="sm" disabled={vehicles.length === 0}
                  onClick={() => setFuelForm({ assetId: vehicles[0]?.id ?? "", filledAt: today(), liters: "", cost: "", meterValue: "", station: "", driverEmployeeId: "" })}>
                  <Icon name="Plus" className="size-4" />تعبئة
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {fuelForm && (
              <div className="space-y-3 rounded-xl border p-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <Label>العربية</Label>
                    <CellCombobox
                      selectedLabel={vehicleById.get(fuelForm.assetId)?.nameAr ?? ""}
                      options={vehicles.map((v) => ({ id: v.id, label: `${v.plateNumber ?? v.code} — ${v.nameAr}` }))}
                      onSelect={(id) => setFuelForm((f) => (f ? { ...f, assetId: id } : f))}
                      placeholder="اختر…"
                    />
                  </div>
                  <div className="space-y-2"><Label>التاريخ</Label>
                    <Input type="date" value={fuelForm.filledAt}
                      onChange={(e) => setFuelForm((f) => (f ? { ...f, filledAt: e.target.value } : f))} /></div>
                  <div className="space-y-2"><Label>اللترات</Label>
                    <Input type="number" step="0.01" min="0" value={fuelForm.liters}
                      onChange={(e) => setFuelForm((f) => (f ? { ...f, liters: e.target.value } : f))} /></div>
                  <div className="space-y-2"><Label>التكلفة</Label>
                    <Input type="number" step="0.01" min="0" value={fuelForm.cost}
                      onChange={(e) => setFuelForm((f) => (f ? { ...f, cost: e.target.value } : f))} /></div>
                  <div className="space-y-2"><Label>قراءة العدّاد</Label>
                    <Input type="number" step="any" min="0" value={fuelForm.meterValue}
                      onChange={(e) => setFuelForm((f) => (f ? { ...f, meterValue: e.target.value } : f))} /></div>
                  <div className="space-y-2"><Label>المحطة</Label>
                    <Input value={fuelForm.station}
                      onChange={(e) => setFuelForm((f) => (f ? { ...f, station: e.target.value } : f))} /></div>
                  <div className="space-y-2">
                    <Label>السائق</Label>
                    <CellCombobox
                      selectedLabel={drivers.find((d) => d.id === fuelForm.driverEmployeeId)?.label ?? ""}
                      options={drivers}
                      onSelect={(id) => setFuelForm((f) => (f ? { ...f, driverEmployeeId: id } : f))}
                      placeholder="اختياري"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button disabled={pending || !fuelForm.assetId || !fuelForm.liters}
                    onClick={() => run(async () => {
                      const r = await logFuelAction({
                        assetId: fuelForm.assetId, filledAt: fuelForm.filledAt,
                        liters: Number(fuelForm.liters) || 0, cost: Number(fuelForm.cost) || 0,
                        meterValue: fuelForm.meterValue === "" ? null : Number(fuelForm.meterValue),
                        station: fuelForm.station || null,
                        driverEmployeeId: fuelForm.driverEmployeeId || null,
                      });
                      if (r.ok) setFuelForm(null);
                      return r;
                    }, "اتسجّلت")}>
                    <Icon name="Check" className="size-4" />احفظ
                  </Button>
                  <Button variant="ghost" onClick={() => setFuelForm(null)}>رجوع</Button>
                </div>
              </div>
            )}

            {fuel.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش تعبئات مسجّلة.</p>
            ) : (
              <div className="rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">التاريخ</TableHead>
                      <TableHead className="text-start">العربية</TableHead>
                      <TableHead className="text-start">اللترات</TableHead>
                      <TableHead className="text-start">التكلفة</TableHead>
                      <TableHead className="text-start">العدّاد</TableHead>
                      <TableHead className="text-start">السائق</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fuel.map((f) => (
                      <TableRow key={f.id} className={outlierIds.has(f.id) ? "bg-destructive/5" : undefined}>
                        <TableCell className="text-sm tabular-nums">{f.at}</TableCell>
                        <TableCell className="text-sm">{f.assetName}</TableCell>
                        <TableCell className="tabular-nums">{num(f.liters)}</TableCell>
                        <TableCell className="tabular-nums">{money(f.cost)}</TableCell>
                        <TableCell className="tabular-nums">
                          {f.meterValue == null ? <span className="text-xs text-destructive">مش مكتوبة</span> : num(f.meterValue)}
                        </TableCell>
                        <TableCell className="text-sm">{f.driverName ?? "—"}</TableCell>
                        <TableCell>
                          {canManage && (
                            <Button size="icon" variant="ghost" aria-label="مسح"
                              onClick={() => void (async () => {
                                const go = await confirm({
                                  danger: true, title: "تمسح التعبئة دي؟",
                                  description: "قراءة العدّاد اللي اتسجّلت معاها هتفضل — دي ملاحظة حقيقية للعدّاد، ومسحها هيخلّي العدّاد يبان راجع لورا.",
                                  confirmText: "امسح", cancelText: "رجوع",
                                });
                                if (go) run(() => deleteFuelLogAction(f.id), "اتمسحت");
                              })()}>
                              <Icon name="Trash2" className="size-4 text-destructive" />
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

      {tab === "trips" && (
        <Card>
          <CardHeader>
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>الرحلات</CardTitle>
                <CardDescription>
                  مين خد العربية وراح فين. المسافة بتتحسب من الرحلات اللي رجعت بس — {num(tripDistance(trips))} كم لحد دلوقتي.
                </CardDescription>
              </div>
              {canManage && (
                <Button size="sm" disabled={vehicles.length === 0}
                  onClick={() => setTripForm({ assetId: vehicles[0]?.id ?? "", driverEmployeeId: "", startedAt: new Date().toISOString().slice(0, 16), endedAt: "", startMeter: String(vehicles[0]?.currentMeter ?? ""), endMeter: "", purpose: "" })}>
                  <Icon name="Plus" className="size-4" />رحلة
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {tripForm && (
              <div className="space-y-3 rounded-xl border p-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <Label>العربية</Label>
                    <CellCombobox
                      selectedLabel={vehicleById.get(tripForm.assetId)?.nameAr ?? ""}
                      options={vehicles.map((v) => ({ id: v.id, label: `${v.plateNumber ?? v.code} — ${v.nameAr}` }))}
                      onSelect={(id) => setTripForm((f) => (f ? { ...f, assetId: id, startMeter: String(vehicleById.get(id)?.currentMeter ?? f.startMeter) } : f))}
                      placeholder="اختر…"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>السائق</Label>
                    <CellCombobox
                      selectedLabel={drivers.find((d) => d.id === tripForm.driverEmployeeId)?.label ?? ""}
                      options={drivers}
                      onSelect={(id) => setTripForm((f) => (f ? { ...f, driverEmployeeId: id } : f))}
                      placeholder="اختياري"
                    />
                  </div>
                  <div className="space-y-2"><Label>البداية</Label>
                    <Input type="datetime-local" value={tripForm.startedAt}
                      onChange={(e) => setTripForm((f) => (f ? { ...f, startedAt: e.target.value } : f))} /></div>
                  <div className="space-y-2"><Label>النهاية</Label>
                    <Input type="datetime-local" value={tripForm.endedAt}
                      onChange={(e) => setTripForm((f) => (f ? { ...f, endedAt: e.target.value } : f))} /></div>
                  <div className="space-y-2"><Label>عدّاد البداية</Label>
                    <Input type="number" step="any" min="0" value={tripForm.startMeter}
                      onChange={(e) => setTripForm((f) => (f ? { ...f, startMeter: e.target.value } : f))} /></div>
                  <div className="space-y-2"><Label>عدّاد النهاية</Label>
                    <Input type="number" step="any" min="0" value={tripForm.endMeter}
                      onChange={(e) => setTripForm((f) => (f ? { ...f, endMeter: e.target.value } : f))} /></div>
                  <div className="space-y-2 sm:col-span-2"><Label>الغرض</Label>
                    <Input value={tripForm.purpose} placeholder="توصيل طلبات المعادي"
                      onChange={(e) => setTripForm((f) => (f ? { ...f, purpose: e.target.value } : f))} /></div>
                </div>
                <div className="flex gap-2">
                  <Button disabled={pending || !tripForm.assetId || tripForm.startMeter === ""}
                    onClick={() => run(async () => {
                      const r = await saveTripAction({
                        id: tripForm.id, assetId: tripForm.assetId,
                        driverEmployeeId: tripForm.driverEmployeeId || null,
                        startedAt: tripForm.startedAt,
                        endedAt: tripForm.endedAt || null,
                        startMeter: Number(tripForm.startMeter) || 0,
                        endMeter: tripForm.endMeter === "" ? null : Number(tripForm.endMeter),
                        purpose: tripForm.purpose || null,
                      });
                      if (r.ok) setTripForm(null);
                      return r;
                    }, "اتحفظت")}>
                    <Icon name="Check" className="size-4" />احفظ
                  </Button>
                  <Button variant="ghost" onClick={() => setTripForm(null)}>رجوع</Button>
                </div>
              </div>
            )}

            {trips.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش رحلات مسجّلة.</p>
            ) : (
              <div className="rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">العربية</TableHead>
                      <TableHead className="text-start">السائق</TableHead>
                      <TableHead className="text-start">البداية</TableHead>
                      <TableHead className="text-start">المسافة</TableHead>
                      <TableHead className="text-start">الغرض</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trips.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="text-sm">{t.assetName}</TableCell>
                        <TableCell className="text-sm">{t.driverName ?? "—"}</TableCell>
                        <TableCell className="text-xs tabular-nums">{t.startedAt}</TableCell>
                        <TableCell className="tabular-nums">
                          {t.endMeter == null
                            ? <Badge variant="outline">لسه بره</Badge>
                            : `${num(t.endMeter - t.startMeter)} ${METER_LABEL.KM}`}
                        </TableCell>
                        <TableCell className="text-sm">{t.purpose ?? "—"}</TableCell>
                        <TableCell>
                          {canManage && (
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" aria-label="تعديل" onClick={() => setTripForm({
                                id: t.id, assetId: t.assetId, driverEmployeeId: t.driverEmployeeId ?? "",
                                startedAt: t.startedAt.replace(" ", "T"),
                                endedAt: t.endedAt ? t.endedAt.slice(0, 16) : "",
                                startMeter: String(t.startMeter),
                                endMeter: t.endMeter == null ? "" : String(t.endMeter),
                                purpose: t.purpose ?? "",
                              })}>
                                <Icon name="Edit" className="size-4" />
                              </Button>
                              <Button size="icon" variant="ghost" aria-label="مسح"
                                onClick={() => void (async () => {
                                  const go = await confirm({
                                    danger: true, title: "تمسح الرحلة؟",
                                    description: "قراءة العدّاد اللي اتسجّلت عند الرجوع هتفضل زي ما هي.",
                                    confirmText: "امسح", cancelText: "رجوع",
                                  });
                                  if (go) run(() => deleteTripAction(t.id), "اتمسحت");
                                })()}>
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
      )}
    </div>
  );
}
