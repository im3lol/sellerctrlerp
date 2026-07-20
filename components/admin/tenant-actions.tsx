"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogIn, SlidersHorizontal, Wallet, Loader2, Download } from "lucide-react";
import { impersonateTenantAction } from "@/app/actions/admin/impersonate";
import { recordCollectionAction } from "@/app/actions/admin/collections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectCls } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const METHODS: Record<string, string> = { INSTAPAY: "إنستاباي", BANK: "تحويل بنكي", VISA: "فيزا", CASH: "نقدًا", OTHER: "أخرى" };
const today = () => new Date().toISOString().slice(0, 10);

/** Quick actions on the tenant profile: enter-for-support, edit licensing, and record
 *  a payment inline (pre-filled for this org) so the owner never loses context. */
export function TenantActions({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: "", method: "INSTAPAY", reference: "", paidAt: today(), note: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const support = () => start(async () => {
    const r = await impersonateTenantAction(orgId); // redirects on success
    if (r && "error" in r) toast.error(r.error);
  });
  const record = () => start(async () => {
    const r = await recordCollectionAction({ organizationId: orgId, ...form, amount: Number(form.amount) });
    if ("ok" in r && r.ok) { toast.success("تم تسجيل التحصيل"); setOpen(false); setForm({ amount: "", method: "INSTAPAY", reference: "", paidAt: today(), note: "" }); router.refresh(); }
    else toast.error(("error" in r && r.error) || "تعذّر التسجيل");
  });

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={support} disabled={pending}><LogIn className="size-4" />دخول للدعم</Button>
      <Button size="sm" variant="outline" asChild><Link href="/admin/licensing"><SlidersHorizontal className="size-4" />تعديل الاشتراك</Link></Button>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Wallet className="size-4" />تسجيل تحصيل</Button>
      <Button size="sm" variant="outline" asChild><a href={`/admin/tenants/${orgId}/backup`} download><Download className="size-4" />نسخة احتياطية</a></Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تسجيل تحصيل</DialogTitle>
            <DialogDescription>مبلغ مستلَم من هذه المؤسسة مقابل اشتراكها.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>المبلغ (ج.م)</Label><Input type="number" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="1750" /></div>
              <div className="space-y-1.5"><Label>التاريخ</Label><Input type="date" value={form.paidAt} onChange={(e) => set("paidAt", e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>الطريقة</Label>
                <select value={form.method} onChange={(e) => set("method", e.target.value)} className={`${selectCls} h-9`}>
                  {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label>المرجع (اختياري)</Label><Input value={form.reference} onChange={(e) => set("reference", e.target.value)} placeholder="رقم العملية" dir="ltr" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={record} disabled={pending || !form.amount}>{pending && <Loader2 className="size-4 animate-spin" />}تسجيل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
