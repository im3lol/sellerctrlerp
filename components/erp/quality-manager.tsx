"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  listInspectionsAction, decideInspectionAction, setItemInspectionAction,
  type InspectionRow,
} from "@/app/actions/erp/quality";
import { validateDecision } from "@/lib/erp/quality";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { CellCombobox } from "@/components/erp/cell-combobox";

export type Option = { id: string; label: string; requiresInspection: boolean };

const qf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

/**
 * The inspection queue. Goods sit in quarantine — costed, visible, unsellable — until
 * somebody passes them. Failing a quantity leaves it in quarantine on purpose: returning
 * it to the supplier or scrapping it is its own decision, and writing it off quietly here
 * would hide a supplier problem inside an adjustment.
 */
export function QualityManager({ items, canDecide, canEdit }: {
  items: Option[]; canDecide: boolean; canEdit: boolean;
}) {
  const [rows, setRows] = useState<InspectionRow[]>([]);
  const [stats, setStats] = useState<{ pending: number; pendingQty: number; decided: number; failRate: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();

  const [deciding, setDeciding] = useState<InspectionRow | null>(null);
  const [passed, setPassed] = useState("");
  const [failed, setFailed] = useState("");
  const [notes, setNotes] = useState("");
  const [itemToFlag, setItemToFlag] = useState("");

  const load = () => {
    setLoading(true);
    void listInspectionsAction().then((r) => {
      setLoading(false);
      if (!r.ok) { toast.error(r.error ?? "تعذّر التحميل"); return; }
      setRows(r.rows ?? []);
      setStats(r.stats ?? null);
    });
  };
  useEffect(() => { load(); }, []);

  const openDecision = (row: InspectionRow) => {
    setDeciding(row);
    setPassed(String(row.quantity));
    setFailed("0");
    setNotes("");
  };

  const decide = () =>
    void (async () => {
      if (!deciding) return;
      const p = Number(passed) || 0;
      const f = Number(failed) || 0;
      const err = validateDecision({ quantity: deciding.quantity, passedQty: p, failedQty: f });
      if (err) return toast.error(err);
      const go = await confirm({
        title: `فحص ${deciding.number}`,
        description: p > 0
          ? `هيتعمل تحويل بـ${qf(p)} من الحجر إلى ${deciding.targetName}${f > 0 ? `، و${qf(f)} هيفضلوا في الحجر لحد ما ترجّعهم أو تعدمهم.` : "."}`
          : `كل الكمية (${qf(f)}) مرفوضة وهتفضل في الحجر لحد ما ترجّعها للمورّد أو تعدمها.`,
        confirmText: "سجّل القرار", cancelText: "رجوع",
      });
      if (!go) return;
      start(async () => {
        const r = await decideInspectionAction({ id: deciding.id, passedQty: p, failedQty: f, notes: notes || null });
        if (r.ok) {
          toast.success(r.transferNumber ? `تم الإفراج بتحويل ${r.transferNumber}` : "تم تسجيل القرار");
          setDeciding(null);
          load();
        } else toast.error(r.error ?? "تعذّر التسجيل");
      });
    })();

  const flagItem = (itemId: string, requires: boolean) =>
    start(async () => {
      const r = await setItemInspectionAction(itemId, requires);
      if (r.ok) { toast.success(requires ? "الصنف بقى تحت الفحص" : "اتشال من الفحص"); load(); }
      else toast.error(r.error ?? "تعذّر التعديل");
    });

  const pendingRows = rows.filter((r) => r.status === "PENDING");
  const flagged = items.filter((i) => i.requiresInspection);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">في انتظار الفحص</div>
          <div className="text-2xl font-bold tabular-nums">{stats?.pending ?? 0}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">كمية محجوزة</div>
          <div className="text-2xl font-bold tabular-nums">{qf(stats?.pendingQty ?? 0)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">تم البتّ فيه</div>
          <div className="text-2xl font-bold tabular-nums">{stats?.decided ?? 0}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">نسبة الرفض</div>
          <div className={`text-2xl font-bold tabular-nums ${(stats?.failRate ?? 0) > 5 ? "text-destructive" : ""}`}>
            {stats?.failRate == null ? "—" : `${stats.failRate}%`}
          </div>
        </CardContent></Card>
      </div>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>أصناف تحت الفحص</CardTitle>
            <CardDescription>
              الصنف المعلَّم هنا بيدخل الحجر أول ما يُستلم، وما يبقاش متاح للبيع غير لما حد يقبله.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-64 flex-1 space-y-2">
                <Label>أضِف صنف</Label>
                <CellCombobox
                  selectedLabel={items.find((i) => i.id === itemToFlag)?.label ?? ""}
                  options={items.filter((i) => !i.requiresInspection).map((i) => ({ id: i.id, label: i.label }))}
                  onSelect={(id) => { setItemToFlag(id); flagItem(id, true); setItemToFlag(""); }}
                  placeholder="ابحث عن الصنف…"
                />
              </div>
            </div>
            {flagged.length === 0 ? (
              <p className="text-sm text-muted-foreground">مفيش أصناف تحت الفحص — الاستلام بيروح للمخزن مباشرة.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {flagged.map((i) => (
                  <span key={i.id} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-sm">
                    {i.label}
                    <button type="button" aria-label="إزالة" className="text-muted-foreground hover:text-destructive"
                      onClick={() => flagItem(i.id, false)}>×</button>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {deciding && (
        <Card>
          <CardHeader>
            <div className="flex w-full flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>قرار الفحص — {deciding.number}</CardTitle>
                <CardDescription>
                  {deciding.itemName} · استلام {deciding.receiptNumber} · الكمية {qf(deciding.quantity)}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={decide} disabled={pending}><Icon name="Check" className="size-4" />سجّل</Button>
                <Button size="sm" variant="outline" onClick={() => setDeciding(null)}>إلغاء</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2"><Label>مقبول</Label>
                <Input type="number" step="any" min="0" className="w-32 tabular-nums" value={passed}
                  onChange={(e) => {
                    setPassed(e.target.value);
                    // The rest is refused by default, so the two halves always add up.
                    const rest = deciding.quantity - (Number(e.target.value) || 0);
                    setFailed(String(Math.max(0, Math.round(rest * 1e4) / 1e4)));
                  }} /></div>
              <div className="space-y-2"><Label>مرفوض</Label>
                <Input type="number" step="any" min="0" className="w-32 tabular-nums" value={failed}
                  onChange={(e) => setFailed(e.target.value)} /></div>
              <div className="min-w-60 flex-1 space-y-2"><Label>السبب</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثال: كسر في التغليف" /></div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              المرفوض بيفضل في الحجر — رجّعه للمورّد بمرتجع شراء أو أعدمه بتسوية. الاتنين قرار لوحده،
              عشان مشكلة المورّد ما تختفيش جوّه تسوية مخزون.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>طابور الفحص</CardTitle>
          <CardDescription>{loading ? "جارٍ التحميل…" : `${pendingRows.length} في الانتظار · ${rows.length} إجمالاً`}</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">
              مفيش سجلات فحص. علّم صنف بأنه «تحت الفحص» وأول استلام ليه هيدخل الحجر بدل المخزن.
            </p>
          ) : (
            <div className="rounded-xl border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الرقم</TableHead>
                    <TableHead className="text-start">الصنف</TableHead>
                    <TableHead className="text-start">الاستلام</TableHead>
                    <TableHead className="text-start">الكمية</TableHead>
                    <TableHead className="text-start">مقبول / مرفوض</TableHead>
                    <TableHead className="text-start">المقصد</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                    {canDecide && <TableHead className="w-24" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.number}</TableCell>
                      <TableCell>
                        <div className="font-medium">{r.itemName}</div>
                        <div className="font-mono text-xs text-muted-foreground" dir="ltr">{r.itemCode}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.receiptNumber}</TableCell>
                      <TableCell className="tabular-nums">{qf(r.quantity)}</TableCell>
                      <TableCell className="tabular-nums">
                        {r.status === "PENDING" ? "—" : (
                          <>
                            <span className="text-emerald-600">{qf(r.passedQty)}</span>
                            {" / "}
                            <span className={r.failedQty > 0 ? "text-destructive" : ""}>{qf(r.failedQty)}</span>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.targetName}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "PENDING" ? "outline" : "secondary"}>
                          {r.status === "PENDING" ? "في الحجر" : "تم البتّ"}
                        </Badge>
                      </TableCell>
                      {canDecide && (
                        <TableCell>
                          {r.status === "PENDING" && (
                            <Button size="sm" variant="outline" onClick={() => openDecision(r)}>افحص</Button>
                          )}
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
    </div>
  );
}
