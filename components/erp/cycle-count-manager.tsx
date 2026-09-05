"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  listCountsAction, generateCountAction, getCountAction, saveCountAction,
  postCountAction, cancelCountAction, type CountDetail,
} from "@/app/actions/erp/cycle-count";
import { countSummary, canPost } from "@/lib/erp/cycle-count";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { PaginatedTableRows } from "@/components/erp/paginated-table-rows";
import { selectCls } from "@/lib/utils";

export type Option = { id: string; label: string };
type ListRow = NonNullable<Awaited<ReturnType<typeof listCountsAction>>["rows"]>[number];

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

const STATUS: Record<string, { label: string; tone: "secondary" | "outline" | "destructive" }> = {
  DRAFT: { label: "ورقة جاهزة", tone: "outline" },
  COUNTED: { label: "معدود", tone: "outline" },
  POSTED: { label: "مُرحّل", tone: "secondary" },
  CANCELLED: { label: "ملغي", tone: "destructive" },
};

/**
 * Cycle counting. The sheet is ordered by bin, so it is one walk through the aisles;
 * the book quantity is hidden while counting, because a counter who can see the expected
 * number tends to find it.
 */
export function CycleCountManager({ warehouses, canManage, canPost: mayPost }: {
  warehouses: Option[]; canManage: boolean; canPost: boolean;
}) {
  const [rows, setRows] = useState<ListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();

  const [gen, setGen] = useState({ warehouseId: warehouses[0]?.id ?? "", method: "VALUE", limit: "25" });
  const [open, setOpen] = useState<CountDetail | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [blind, setBlind] = useState(true);

  const load = () => {
    setLoading(true);
    void listCountsAction().then((r) => {
      setLoading(false);
      if (!r.ok) { toast.error(r.error ?? "تعذّر التحميل"); return; }
      setRows(r.rows ?? []);
    });
  };
  useEffect(() => { load(); }, []);

  const openSession = (id: string) =>
    void getCountAction(id).then((r) => {
      if (!r.ok || !r.detail) { toast.error(r.error ?? "تعذّر الفتح"); return; }
      setOpen(r.detail);
      setCounts(Object.fromEntries(r.detail.lines.map((l) => [l.itemId, l.countedQty == null ? "" : String(l.countedQty)])));
    });

  const generate = () => {
    if (!gen.warehouseId) return toast.error("اختر المستودع");
    start(async () => {
      const r = await generateCountAction({
        warehouseId: gen.warehouseId,
        method: gen.method as "VALUE" | "MOVEMENT",
        limit: Number(gen.limit) || 25,
      });
      if (!r.ok) { toast.error(r.error ?? "تعذّر الإنشاء"); return; }
      toast.success(`ورقة ${r.number} — ${r.count} صنف`);
      load();
      if (r.id) openSession(r.id);
    });
  };

  const saveCounts = () => {
    if (!open) return;
    start(async () => {
      const r = await saveCountAction({
        sessionId: open.session.id,
        counts: open.lines.map((l) => ({
          itemId: l.itemId,
          countedQty: counts[l.itemId] === "" || counts[l.itemId] == null ? null : Number(counts[l.itemId]),
        })),
      });
      if (r.ok) { toast.success("تم الحفظ"); openSession(open.session.id); load(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  const post = () =>
    void (async () => {
      if (!open) return;
      const shaped = open.lines.map((l) => ({
        itemId: l.itemId, systemQty: l.systemQty, unitCost: l.unitCost,
        countedQty: counts[l.itemId] === "" || counts[l.itemId] == null ? null : Number(counts[l.itemId]),
      }));
      const blocked = canPost(shaped);
      if (blocked) return toast.error(blocked);
      const s = countSummary(shaped);
      const go = await confirm({
        danger: true,
        title: `ترحيل جرد ${open.session.number}؟`,
        description: `هيتعمل تسوية مخزون بـ${s.counted - s.matched} فرق، صافي أثرها ${money(s.netValue)} ج.م — وده بيتقيّد في الدفاتر.`,
        confirmText: "رحّل التسوية", cancelText: "رجوع",
      });
      if (!go) return;
      start(async () => {
        const r = await postCountAction(open.session.id);
        if (r.ok) { toast.success(`تم الترحيل عبر تسوية ${r.adjustmentNumber ?? ""}`); setOpen(null); load(); }
        else toast.error(r.error ?? "تعذّر الترحيل");
      });
    })();

  const cancel = (row: ListRow) =>
    void (async () => {
      const go = await confirm({ danger: true, title: `إلغاء ${row.number}؟`, description: "الورقة هتتقفل من غير تسوية.", confirmText: "ألغِ", cancelText: "رجوع" });
      if (!go) return;
      start(async () => {
        const r = await cancelCountAction(row.id);
        if (r.ok) { toast.success("تم الإلغاء"); load(); setOpen(null); }
        else toast.error(r.error ?? "تعذّر الإلغاء");
      });
    })();

  if (open) {
    const live = countSummary(open.lines.map((l) => ({
      itemId: l.itemId, systemQty: l.systemQty, unitCost: l.unitCost,
      countedQty: counts[l.itemId] === "" || counts[l.itemId] == null ? null : Number(counts[l.itemId]),
    })));
    const editable = open.session.status === "DRAFT" || open.session.status === "COUNTED";

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex w-full flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{open.session.number}</CardTitle>
                <CardDescription>
                  {open.session.warehouseName} · {open.session.date} · {open.lines.length} صنف — مرتّبة بترتيب المشي في المخزن
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={STATUS[open.session.status]?.tone ?? "outline"}>{STATUS[open.session.status]?.label ?? open.session.status}</Badge>
                {canManage && editable && (
                  <Button size="sm" variant="outline" onClick={saveCounts} disabled={pending}>
                    <Icon name="Check" className="size-4" />احفظ العدّ
                  </Button>
                )}
                {mayPost && editable && (
                  <Button size="sm" onClick={post} disabled={pending}>
                    <Icon name="Upload" className="size-4" />رحّل الفروق
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>رجوع</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6 text-sm">
            <div><div className="text-muted-foreground">اتعدّ</div><div className="font-bold tabular-nums">{live.counted} / {live.total}</div></div>
            <div><div className="text-muted-foreground">مطابق</div><div className="font-bold tabular-nums">{live.matched}</div></div>
            <div><div className="text-muted-foreground">الدقة</div><div className="font-bold tabular-nums">{live.accuracy == null ? "—" : `${live.accuracy}%`}</div></div>
            <div><div className="text-muted-foreground">عجز</div><div className="font-bold tabular-nums text-destructive">{money(live.shortageValue)}</div></div>
            <div><div className="text-muted-foreground">زيادة</div><div className="font-bold tabular-nums text-emerald-600">{money(live.surplusValue)}</div></div>
            <label className="ms-auto flex cursor-pointer items-center gap-2">
              <input type="checkbox" className="size-4 rounded border-input" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
              جرد أعمى (إخفاء رصيد الدفاتر)
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ورقة العدّ</CardTitle>
            <CardDescription>
              الجرد الأعمى بيخفي رصيد الدفاتر أثناء العدّ — اللي بيشوف الرقم المتوقّع بيلاقيه.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الموقع</TableHead>
                    <TableHead className="text-start">الصنف</TableHead>
                    {!blind && <TableHead className="text-start">الدفاتر</TableHead>}
                    <TableHead className="w-32 text-start">المعدود</TableHead>
                    {!blind && <TableHead className="text-start">الفرق</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <PaginatedTableRows rows={open.lines.map((l) => {
                    const raw = counts[l.itemId];
                    const counted = raw === "" || raw == null ? null : Number(raw);
                    const diff = counted == null ? null : counted - l.systemQty;
                    return (
                      <TableRow key={l.itemId}>
                        <TableCell className="font-mono text-xs" dir="ltr">{l.binCode ?? "—"}</TableCell>
                        <TableCell>
                          <div className="font-medium">{l.name}</div>
                          <div className="font-mono text-xs text-muted-foreground" dir="ltr">{l.code}</div>
                        </TableCell>
                        {!blind && <TableCell className="tabular-nums text-muted-foreground">{qf(l.systemQty)}</TableCell>}
                        <TableCell>
                          <Input
                            type="number" step="any" min="0" className="w-28 tabular-nums"
                            disabled={!canManage || !editable || pending}
                            value={raw ?? ""}
                            onChange={(e) => setCounts((c) => ({ ...c, [l.itemId]: e.target.value }))}
                          />
                        </TableCell>
                        {!blind && (
                          <TableCell className={`tabular-nums ${diff == null ? "" : diff === 0 ? "text-muted-foreground" : diff > 0 ? "text-emerald-600" : "text-destructive"}`}>
                            {diff == null ? "—" : diff > 0 ? `+${qf(diff)}` : qf(diff)}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })} />
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>ورقة جرد جديدة</CardTitle>
            <CardDescription>
              «بالقيمة» بتختار الأصناف اللي الخطأ فيها بيكلّف أكتر · «بالحركة» بتختار اللي بتتحرّك كتير فالخطأ بيتسلّل ليها.
              الصنف اللي معدّش قبل كده بييجي الأول دايماً.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <Label>المستودع</Label>
                <select className={`${selectCls} w-52`} value={gen.warehouseId} onChange={(e) => setGen((g) => ({ ...g, warehouseId: e.target.value }))}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label>الاختيار</Label>
                <select className={`${selectCls} w-40`} value={gen.method} onChange={(e) => setGen((g) => ({ ...g, method: e.target.value }))}>
                  <option value="VALUE">بالقيمة</option>
                  <option value="MOVEMENT">بالحركة</option>
                </select>
              </div>
              <div className="space-y-2"><Label>عدد الأصناف</Label>
                <Input type="number" min="1" max="500" className="w-28" value={gen.limit}
                  onChange={(e) => setGen((g) => ({ ...g, limit: e.target.value }))} /></div>
              <Button onClick={generate} disabled={pending}><Icon name="Plus" className="size-4" />اطلع الورقة</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>الجرد الدوري</CardTitle>
          <CardDescription>{loading ? "جارٍ التحميل…" : `${rows.length} ورقة`}</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">
              مفيش أوراق جرد. الجرد الدوري بيعدّ شريحة كل أسبوع بدل ما تقفل المخزن يوم كامل مرة في السنة.
            </p>
          ) : (
            <div className="rounded-xl border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الرقم</TableHead>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">المستودع</TableHead>
                    <TableHead className="text-start">أصناف</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.number}</TableCell>
                      <TableCell className="text-xs" dir="ltr">{r.date}</TableCell>
                      <TableCell>{r.warehouseName}</TableCell>
                      <TableCell className="tabular-nums">{r.lines}</TableCell>
                      <TableCell><Badge variant={STATUS[r.status]?.tone ?? "outline"}>{STATUS[r.status]?.label ?? r.status}</Badge></TableCell>
                      <TableCell className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => openSession(r.id)}>افتح</Button>
                        {canManage && r.status !== "POSTED" && r.status !== "CANCELLED" && (
                          <Button size="icon" variant="ghost" aria-label="إلغاء" onClick={() => cancel(r)}>
                            <Icon name="Ban" className="size-4 text-destructive" />
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
    </div>
  );
}
