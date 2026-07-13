"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createHolidayAction, deleteHolidayAction, bulkDeleteHolidaysAction } from "@/app/actions/erp/holidays";
import { useSelection, BulkDeleteBar, SelectBox } from "@/components/erp/bulk-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";

type Holiday = { id: string; date: string; nameAr: string };
const dt = (d: string) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export function HolidaysManager({ holidays, canManage }: { holidays: Holiday[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [nameAr, setNameAr] = useState("");
  const sel = useSelection();
  const allIds = holidays.map((h) => h.id);

  const add = () => {
    if (!nameAr.trim()) return toast.error("أدخل اسم العطلة");
    start(async () => {
      const r = await createHolidayAction({ date, nameAr });
      if (r.ok) { toast.success("تمت الإضافة"); setNameAr(""); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };
  const remove = (id: string) =>
    start(async () => {
      const r = await deleteHolidayAction(id);
      if (r.ok) { toast.success("تم الحذف"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحذف");
    });

  return (
    <div className="space-y-6">
      {canManage && (
        <Card>
          <CardHeader><CardTitle>إضافة عطلة</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2"><Label htmlFor="hdate">التاريخ</Label><Input id="hdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-48" /></div>
              <div className="space-y-2 min-w-56 flex-1"><Label htmlFor="hname">اسم العطلة</Label><Input id="hname" value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="مثال: عيد الفطر" /></div>
              <Button onClick={add} disabled={pending}><Icon name="Plus" className="size-4" />إضافة</Button>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-0">
          {holidays.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد عطلات مُسجّلة.</div>
          ) : (
            <>
            {canManage && <BulkDeleteBar ids={sel.ids} action={bulkDeleteHolidaysAction} onDone={sel.clear} entity="إجازة" />}
            <Table>
              <TableHeader><TableRow>
                {canManage && <TableHead className="w-10"><SelectBox label="تحديد الكل" checked={sel.allOf(allIds)} indeterminate={sel.someOf(allIds)} onChange={() => sel.togglePage(allIds)} /></TableHead>}
                <TableHead className="text-start">التاريخ</TableHead><TableHead className="text-start">العطلة</TableHead>
                {canManage && <TableHead className="w-10" />}
              </TableRow></TableHeader>
              <TableBody>
                {holidays.map((h) => (
                  <TableRow key={h.id} data-state={sel.has(h.id) ? "selected" : undefined}>
                    {canManage && <TableCell><SelectBox label="تحديد" checked={sel.has(h.id)} onChange={() => sel.toggle(h.id)} /></TableCell>}
                    <TableCell className="tabular-nums">{dt(h.date)}</TableCell>
                    <TableCell>{h.nameAr}</TableCell>
                    {canManage && <TableCell><Button variant="ghost" size="icon" disabled={pending} aria-label="حذف" onClick={() => remove(h.id)}><Icon name="Trash2" className="size-4 text-destructive" /></Button></TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
