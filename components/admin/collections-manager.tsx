"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { recordCollectionAction, deleteCollectionAction } from "@/app/actions/admin/collections";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Row = { id: string; orgId: string; orgName: string; amount: number; method: string; reference: string | null; paidAt: string };
const METHODS: Record<string, string> = { INSTAPAY: "إنستاباي", BANK: "تحويل بنكي", VISA: "فيزا", CASH: "نقدًا", OTHER: "أخرى" };
const egp = (n: number) => `${Number(n).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 0 })} ج.م`;
const dt = (s: string) => new Date(s).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "short", day: "numeric" });
const today = () => new Date().toISOString().slice(0, 10);

export function CollectionsManager({ orgs, rows }: { orgs: { id: string; name: string }[]; rows: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ organizationId: "", amount: "", method: "INSTAPAY", reference: "", paidAt: today(), note: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const close = () => { setOpen(false); setForm({ organizationId: "", amount: "", method: "INSTAPAY", reference: "", paidAt: today(), note: "" }); };

  const record = () => start(async () => {
    const r = await recordCollectionAction({ ...form, amount: Number(form.amount) });
    if ("ok" in r && r.ok) { toast.success("تم تسجيل التحصيل"); close(); router.refresh(); }
    else toast.error(("error" in r && r.error) || "تعذّر التسجيل");
  });
  const del = (id: string) => start(async () => {
    const r = await deleteCollectionAction(id);
    if ("ok" in r && r.ok) { toast.success("تم الحذف"); router.refresh(); } else toast.error(("error" in r && r.error) || "");
  });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between p-4">
          <span className="text-sm text-muted-foreground">{rows.length} تحصيل — أحدث ما سُجّل</span>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" />تسجيل تحصيل</Button>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-start">المؤسسة</TableHead><TableHead className="text-start">المبلغ</TableHead>
            <TableHead className="text-start">الطريقة</TableHead><TableHead className="text-start">المرجع</TableHead>
            <TableHead className="text-start">التاريخ</TableHead><TableHead className="text-start">إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">لا تحصيلات مسجّلة بعد.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.orgName}</TableCell>
                <TableCell className="tabular-nums font-semibold">{egp(r.amount)}</TableCell>
                <TableCell><Badge variant="secondary">{METHODS[r.method] ?? r.method}</Badge></TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground" dir="ltr">{r.reference || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{dt(r.paidAt)}</TableCell>
                <TableCell><Button size="sm" variant="ghost" disabled={pending} onClick={() => del(r.id)}><Trash2 className="size-4 text-destructive" />حذف</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تسجيل تحصيل اشتراك</DialogTitle>
            <DialogDescription>سجّل مبلغًا استلمته من مؤسسة مقابل اشتراكها.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>المؤسسة</Label>
              <select value={form.organizationId} onChange={(e) => set("organizationId", e.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                <option value="">— اختر —</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>المبلغ (ج.م)</Label><Input type="number" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="1750" /></div>
              <div className="space-y-1.5"><Label>التاريخ</Label><Input type="date" value={form.paidAt} onChange={(e) => set("paidAt", e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>الطريقة</Label>
                <select value={form.method} onChange={(e) => set("method", e.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                  {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label>المرجع (اختياري)</Label><Input value={form.reference} onChange={(e) => set("reference", e.target.value)} placeholder="رقم العملية" dir="ltr" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>إلغاء</Button>
            <Button onClick={record} disabled={pending || !form.organizationId || !form.amount}>{pending && <Loader2 className="size-4 animate-spin" />}تسجيل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
