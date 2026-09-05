"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  listCustodyAction, issueCustodyAction, settleCustodyAction, cancelCustodyAction,
} from "@/app/actions/erp/custody";
import { settlementTotal, validateSettlement } from "@/lib/erp/custody";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { CellCombobox } from "@/components/erp/cell-combobox";

export type Option = { id: string; label: string };
type Rows = NonNullable<Awaited<ReturnType<typeof listCustodyAction>>["rows"]>;
type Row = Rows[number];
type Settlements = NonNullable<Awaited<ReturnType<typeof listCustodyAction>>["settlements"]>;

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS: Record<string, { label: string; tone: "secondary" | "outline" | "destructive" }> = {
  OPEN: { label: "مفتوحة", tone: "outline" },
  SETTLED: { label: "مقفولة", tone: "secondary" },
  CANCELLED: { label: "ملغية", tone: "destructive" },
  DRAFT: { label: "مسودة", tone: "outline" },
};

type SLine = { expenseAccountId: string; amount: number; description: string };

/**
 * Custody: cash out to a person, then the accounting for it. The balance column is the
 * whole point — it is what that person still holds and has not accounted for.
 */
export function CustodyManager({ employees, cashAccounts, expenseAccounts, canManage }: {
  employees: Option[]; cashAccounts: Option[]; expenseAccounts: Option[]; canManage: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [settlements, setSettlements] = useState<Settlements>({});
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();

  const [issue, setIssue] = useState({ employeeId: "", cashAccountId: "", date: new Date().toISOString().slice(0, 10), amount: "", purpose: "" });
  const [settling, setSettling] = useState<Row | null>(null);
  const [sLines, setSLines] = useState<SLine[]>([]);
  const [returned, setReturned] = useState("");

  const load = () => {
    setLoading(true);
    void listCustodyAction().then((r) => {
      setLoading(false);
      if (!r.ok) { toast.error(r.error ?? "تعذّر التحميل"); return; }
      setRows(r.rows ?? []);
      setSettlements(r.settlements ?? {});
    });
  };
  useEffect(() => { load(); }, []);

  const submitIssue = () => {
    if (!issue.employeeId) return toast.error("اختر الموظف");
    if (!issue.cashAccountId) return toast.error("اختر حساب النقدية");
    if (!(Number(issue.amount) > 0)) return toast.error("أدخل المبلغ");
    start(async () => {
      const r = await issueCustodyAction({
        employeeId: issue.employeeId, cashAccountId: issue.cashAccountId,
        date: issue.date, amount: Number(issue.amount), purpose: issue.purpose || null,
      });
      if (r.ok) {
        toast.success(`تم صرف العهدة ${r.number ?? ""}`);
        setIssue({ ...issue, amount: "", purpose: "" });
        load(); router.refresh();
      } else toast.error(r.error ?? "تعذّر الصرف");
    });
  };

  const openSettle = (row: Row) => {
    setSettling(row);
    setSLines([{ expenseAccountId: "", amount: 0, description: "" }]);
    setReturned("");
  };

  const submitSettle = () => {
    if (!settling) return;
    const lines = sLines.filter((l) => l.expenseAccountId || l.amount > 0);
    const err = validateSettlement({
      lines, returnedAmount: Number(returned) || 0,
      advanceAmount: settling.amount, alreadySettled: settling.settled,
    });
    if (err) return toast.error(err);
    start(async () => {
      const r = await settleCustodyAction({
        advanceId: settling.id, date: new Date().toISOString().slice(0, 10),
        returnedAmount: Number(returned) || 0,
        lines: lines.map((l) => ({ expenseAccountId: l.expenseAccountId, amount: l.amount, description: l.description || null })),
      });
      if (r.ok) { toast.success("تم تسجيل التسوية"); setSettling(null); load(); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التسجيل");
    });
  };

  const cancel = (row: Row) =>
    void (async () => {
      const go = await confirm({
        danger: true, title: `إلغاء عهدة ${row.number}؟`,
        description: "هيتعكس قيدها وترجع النقدية مكانها. مينفعش لو في تسويات مسجّلة عليها.",
        confirmText: "ألغِ العهدة", cancelText: "رجوع",
      });
      if (!go) return;
      start(async () => {
        const r = await cancelCustodyAction(row.id);
        if (r.ok) { toast.success("تم الإلغاء"); load(); }
        else toast.error(r.error ?? "تعذّر الإلغاء");
      });
    })();

  const openTotal = rows.filter((r) => r.status === "OPEN").reduce((s, r) => s + r.left, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">عهد مفتوحة</div>
          <div className="text-2xl font-bold tabular-nums">{rows.filter((r) => r.status === "OPEN").length}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">رصيد في عهدة الموظفين</div>
          <div className="text-2xl font-bold tabular-nums">{money(openTotal)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">عهد مقفولة</div>
          <div className="text-2xl font-bold tabular-nums">{rows.filter((r) => r.status === "SETTLED").length}</div>
        </CardContent></Card>
      </div>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>صرف عهدة</CardTitle>
            <CardDescription>النقدية بتخرج دلوقتي، وبتفضل محمّلة على الموظف لحد ما يقدّم فواتيره أو يرجّع الباقي.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
              <div className="space-y-2 sm:col-span-2">
                <Label>الموظف</Label>
                <CellCombobox
                  selectedLabel={employees.find((e) => e.id === issue.employeeId)?.label ?? ""}
                  options={employees} onSelect={(id) => setIssue((f) => ({ ...f, employeeId: id }))}
                  placeholder="ابحث بالاسم…"
                />
              </div>
              <div className="space-y-2">
                <Label>من حساب</Label>
                <CellCombobox
                  selectedLabel={cashAccounts.find((a) => a.id === issue.cashAccountId)?.label ?? ""}
                  options={cashAccounts} onSelect={(id) => setIssue((f) => ({ ...f, cashAccountId: id }))}
                  placeholder="الخزينة/البنك…"
                />
              </div>
              <div className="space-y-2"><Label>التاريخ</Label>
                <Input type="date" value={issue.date} onChange={(e) => setIssue((f) => ({ ...f, date: e.target.value }))} /></div>
              <div className="space-y-2"><Label>المبلغ</Label>
                <Input type="number" step="0.01" min="0" value={issue.amount} onChange={(e) => setIssue((f) => ({ ...f, amount: e.target.value }))} /></div>
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="min-w-60 flex-1 space-y-2"><Label>الغرض</Label>
                <Input value={issue.purpose} onChange={(e) => setIssue((f) => ({ ...f, purpose: e.target.value }))} placeholder="مثال: مصاريف شحن ونقل" /></div>
              <Button onClick={submitIssue} disabled={pending}><Icon name="HandCoins" className="size-4" />اصرف</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {settling && (
        <Card>
          <CardHeader>
            <div className="flex w-full flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>تسوية عهدة {settling.number}</CardTitle>
                <CardDescription>
                  {settling.employeeName} · المتبقّي {money(settling.left)} — سجّل المصروفات والباقي اللي رجع.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={submitSettle} disabled={pending}><Icon name="Check" className="size-4" />سجّل</Button>
                <Button size="sm" variant="outline" onClick={() => setSettling(null)}>إلغاء</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">حساب المصروف</TableHead>
                    <TableHead className="w-32 text-start">المبلغ</TableHead>
                    <TableHead className="text-start">البيان</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sLines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="min-w-64">
                        <CellCombobox
                          selectedLabel={expenseAccounts.find((a) => a.id === l.expenseAccountId)?.label ?? ""}
                          options={expenseAccounts}
                          onSelect={(id) => setSLines((ls) => ls.map((x, k) => (k === i ? { ...x, expenseAccountId: id } : x)))}
                          placeholder="ابحث عن الحساب…"
                        />
                      </TableCell>
                      <TableCell>
                        <Input type="number" step="0.01" min="0" className="w-28 tabular-nums" value={l.amount || ""}
                          onChange={(e) => setSLines((ls) => ls.map((x, k) => (k === i ? { ...x, amount: Number(e.target.value) || 0 } : x)))} />
                      </TableCell>
                      <TableCell>
                        <Input value={l.description}
                          onChange={(e) => setSLines((ls) => ls.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)))}
                          placeholder="اختياري" />
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" aria-label="حذف"
                          onClick={() => setSLines((ls) => ls.filter((_, k) => k !== i))}>
                          <Icon name="Trash2" className="size-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Button size="sm" variant="outline" onClick={() => setSLines((ls) => [...ls, { expenseAccountId: "", amount: 0, description: "" }])}>
                <Icon name="Plus" className="size-4" />سطر
              </Button>
              <div className="space-y-2"><Label>نقدية مرتجعة</Label>
                <Input type="number" step="0.01" min="0" className="w-32" value={returned} onChange={(e) => setReturned(e.target.value)} placeholder="0" /></div>
              <span className="text-sm text-muted-foreground">
                إجمالي التسوية {money(settlementTotal(sLines, Number(returned) || 0))} من {money(settling.left)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>العُهد</CardTitle>
          <CardDescription>{loading ? "جارٍ التحميل…" : `${rows.length} عهدة`}</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">مفيش عهد مسجّلة.</p>
          ) : (
            <div className="rounded-xl border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الرقم</TableHead>
                    <TableHead className="text-start">الموظف</TableHead>
                    <TableHead className="text-start">التاريخ</TableHead>
                    <TableHead className="text-start">المبلغ</TableHead>
                    <TableHead className="text-start">المُسوّى</TableHead>
                    <TableHead className="text-start">المتبقّي</TableHead>
                    <TableHead className="text-start">الحالة</TableHead>
                    {canManage && <TableHead className="w-40" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">
                        {r.number}
                        {(settlements[r.id]?.length ?? 0) > 0 && (
                          <span className="block text-[11px] text-muted-foreground">{settlements[r.id].length} تسوية</span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        {r.employeeName}
                        {r.purpose && <span className="block text-xs text-muted-foreground">{r.purpose}</span>}
                      </TableCell>
                      <TableCell className="text-xs" dir="ltr">{r.date}</TableCell>
                      <TableCell className="tabular-nums">{money(r.amount)}</TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{money(r.settled)}</TableCell>
                      <TableCell className={`font-bold tabular-nums ${r.left > 0 ? "text-amber-600" : ""}`}>{money(r.left)}</TableCell>
                      <TableCell><Badge variant={STATUS[r.status]?.tone ?? "outline"}>{STATUS[r.status]?.label ?? r.status}</Badge></TableCell>
                      {canManage && (
                        <TableCell className="flex gap-1">
                          {r.status === "OPEN" && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => openSettle(r)}>تسوية</Button>
                              {r.settled === 0 && (
                                <Button size="icon" variant="ghost" aria-label="إلغاء" onClick={() => cancel(r)}>
                                  <Icon name="Ban" className="size-4 text-destructive" />
                                </Button>
                              )}
                            </>
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
