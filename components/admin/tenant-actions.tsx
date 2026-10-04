"use client";

import { useState, useTransition } from "react";
import { fill } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { LogIn, SlidersHorizontal, Wallet, Loader2, Download, Trash2, TriangleAlert } from "lucide-react";
import { impersonateTenantAction } from "@/app/actions/admin/impersonate";
import { recordCollectionAction } from "@/app/actions/admin/collections";
import { deleteTenantAction } from "@/app/actions/admin/tenants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectCls } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const METHODS: Record<string, string> = { INSTAPAY: "إنستاباي", BANK: "تحويل بنكي", VISA: "فيزا", CASH: "نقدًا", OTHER: "أخرى" };
const today = () => new Date().toISOString().slice(0, 10);

/** Quick actions on the tenant profile: enter-for-support, edit licensing, and record
 *  a payment inline (pre-filled for this org) so the owner never loses context. */
export function TenantActions({ orgId, orgName }: { orgId: string; orgName: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: "", method: "INSTAPAY", reference: "", paidAt: today(), note: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Danger zone: permanently delete the tenant + all its data (typed-name confirmation).
  const [delOpen, setDelOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const remove = () => start(async () => {
    const r = await deleteTenantAction({ orgId, confirmName });
    if ("ok" in r && r.ok) { toast.success(fill(t("تم حذف مؤسسة «{0}» وكل بياناتها نهائيًا"), [orgName])); router.push("/admin/licensing"); router.refresh(); }
    else toast.error(("error" in r && r.error) || t("تعذّر الحذف"));
  });

  const support = () => start(async () => {
    const r = await impersonateTenantAction(orgId); // redirects on success
    if (r && "error" in r) toast.error(r.error);
  });
  const record = () => start(async () => {
    const r = await recordCollectionAction({ organizationId: orgId, ...form, amount: Number(form.amount) });
    if ("ok" in r && r.ok) { toast.success("تم تسجيل التحصيل"); setOpen(false); setForm({ amount: "", method: "INSTAPAY", reference: "", paidAt: today(), note: "" }); router.refresh(); }
    else toast.error(("error" in r && r.error) || t("تعذّر التسجيل"));
  });

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={support} disabled={pending}><LogIn className="size-4" />{t("دخول للدعم")}</Button>
      <Button size="sm" variant="outline" asChild><Link href="/admin/licensing"><SlidersHorizontal className="size-4" />{t("تعديل الاشتراك")}</Link></Button>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Wallet className="size-4" />{t("تسجيل تحصيل")}</Button>
      <Button size="sm" variant="outline" asChild><a href={`/admin/tenants/${orgId}/backup`} download><Download className="size-4" />{t("نسخة احتياطية")}</a></Button>
      <Button size="sm" variant="outline" onClick={() => { setConfirmName(""); setDelOpen(true); }} className="border-destructive/40 text-destructive hover:bg-destructive/10"><Trash2 className="size-4" />{t("حذف المؤسسة")}</Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("تسجيل تحصيل")}</DialogTitle>
            <DialogDescription>{t("مبلغ مستلَم من هذه المؤسسة مقابل اشتراكها.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{t("المبلغ (ج.م)")}</Label><Input type="number" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="1750" /></div>
              <div className="space-y-1.5"><Label>{t("التاريخ")}</Label><Input type="date" value={form.paidAt} onChange={(e) => set("paidAt", e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("الطريقة")}</Label>
                <select value={form.method} onChange={(e) => set("method", e.target.value)} className={`${selectCls} h-9`}>
                  {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label>{t("المرجع (اختياري)")}</Label><Input value={form.reference} onChange={(e) => set("reference", e.target.value)} placeholder={t("رقم العملية")} dir="ltr" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("إلغاء")}</Button>
            <Button onClick={record} disabled={pending || !form.amount}>{pending && <Loader2 className="size-4 animate-spin" />}{t("تسجيل")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Danger zone — permanent delete with typed-name confirmation */}
      <Dialog open={delOpen} onOpenChange={(o) => !o && setDelOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive"><TriangleAlert className="size-5" />{t("حذف المؤسسة نهائيًا")}</DialogTitle>
            <DialogDescription>
              {fill(t("سيُحذف كل شيء يخص «{0}» بشكل لا يمكن التراجع عنه: المستخدمون، الفواتير، القيود، المخزون، الاشتراك، والربط بالمنصات."), [orgName])}
              {" "}{t("للتأكيد، اكتب اسم المؤسسة بالضبط:")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{t("اسم المؤسسة")}</Label>
            <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={orgName} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelOpen(false)}>{t("إلغاء")}</Button>
            <Button variant="destructive" onClick={remove} disabled={pending || confirmName.trim() !== orgName.trim()}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}{t("حذف نهائي")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
