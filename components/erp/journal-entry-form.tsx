"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createManualEntryAction } from "@/app/actions/erp/journal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";

type Option = { id: string; code: string; nameAr: string };
type Line = { accountId: string; description: string; debit: string; credit: string; costCenterId: string };

const emptyLine = (): Line => ({ accountId: "", description: "", debit: "", credit: "", costCenterId: "" });
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function JournalEntryForm({
  accounts,
  costCenters,
}: {
  accounts: Option[];
  costCenters: Option[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const credit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    const diff = Math.round((debit - credit) * 100) / 100;
    return { debit, credit, diff, balanced: diff === 0 && debit > 0 };
  }, [lines]);

  const update = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (i: number) => setLines((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));

  const submit = (mode: "draft" | "post") =>
    start(async () => {
      if (!description.trim()) {
        toast.error("أدخل بيان القيد");
        return;
      }
      const payload = {
        date,
        description,
        reference,
        mode,
        lines: lines
          .filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0))
          .map((l) => ({
            accountId: l.accountId,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            description: l.description,
            costCenterId: l.costCenterId || undefined,
          })),
      };
      const r = await createManualEntryAction(payload);
      if (r.ok) {
        toast.success(mode === "post" ? "تم ترحيل القيد" : "تم حفظ المسودة");
        router.push("/erp/accounting/journal");
        router.refresh();
      } else {
        toast.error(r.error ?? "تعذّر الحفظ");
      }
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>بيانات القيد</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="date">التاريخ</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="desc">البيان</Label>
            <Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="وصف القيد" />
          </div>
          <div className="space-y-2 sm:col-span-3">
            <Label htmlFor="ref">المرجع (اختياري)</Label>
            <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="رقم مستند / مرجع" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>البنود</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الحساب</TableHead>
                <TableHead className="text-start">البيان</TableHead>
                <TableHead className="text-start w-32">مدين</TableHead>
                <TableHead className="text-start w-32">دائن</TableHead>
                {costCenters.length > 0 && <TableHead className="text-start">مركز التكلفة</TableHead>}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <select
                      className={`${selectCls} min-w-48`}
                      value={l.accountId}
                      onChange={(e) => update(i, { accountId: e.target.value })}
                    >
                      <option value="">— اختر الحساب —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.code} — {a.nameAr}</option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Input value={l.description} onChange={(e) => update(i, { description: e.target.value })} placeholder="بيان" />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={l.debit}
                      onChange={(e) => update(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={l.credit}
                      onChange={(e) => update(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
                    />
                  </TableCell>
                  {costCenters.length > 0 && (
                    <TableCell>
                      <select
                        className={selectCls}
                        value={l.costCenterId}
                        onChange={(e) => update(i, { costCenterId: e.target.value })}
                      >
                        <option value="">—</option>
                        {costCenters.map((c) => (
                          <option key={c.id} value={c.id}>{c.code} — {c.nameAr}</option>
                        ))}
                      </select>
                    </TableCell>
                  )}
                  <TableCell>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(i)} disabled={lines.length <= 2}>
                      <Icon name="Trash2" className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="font-bold">
                <TableCell colSpan={2}>الإجمالي</TableCell>
                <TableCell>{fmt(totals.debit)}</TableCell>
                <TableCell>{fmt(totals.credit)}</TableCell>
                <TableCell colSpan={costCenters.length > 0 ? 2 : 1}>
                  <span className={totals.balanced ? "text-emerald-600" : "text-destructive"}>
                    {totals.diff === 0 ? "متوازن" : `فرق ${fmt(totals.diff)}`}
                  </span>
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="outline" onClick={addLine}>
              <Icon name="Plus" className="size-4" />إضافة بند
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={pending} onClick={() => submit("draft")}>
                حفظ كمسودة
              </Button>
              <Button type="button" disabled={pending || !totals.balanced} onClick={() => submit("post")}>
                <Icon name="Check" className="size-4" />حفظ وترحيل
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
