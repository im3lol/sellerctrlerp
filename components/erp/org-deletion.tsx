"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { requestOrgDeletionAction, cancelOrgDeletionAction } from "@/app/actions/erp/org-deletion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const day = (iso: string) => new Date(iso).toLocaleDateString("ar-EG-u-nu-latn", { dateStyle: "long" });

/** Owner-only danger zone: request (or cancel) deleting the whole company. */
export function OrgDeletionCard({ orgName, dueAt, graceDays }: { orgName: string; dueAt: string | null; graceDays: number }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => {
    const r = await fn();
    if (!r.ok) { toast.error(r.error ?? "حصلت مشكلة"); return; }
    toast.success(done);
    setName("");
    router.refresh();
  });

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">حذف الشركة</CardTitle>
        <CardDescription>
          بيمسح كل بيانات الشركة نهائيًا — المستندات والحسابات والمخزون والأعضاء. الحذف بيتم بعد {graceDays} يوم من الطلب، وتقدر تلغيه في أي وقت قبلها.
          نزّل نسخة من بياناتك الأول من «النسخ الاحتياطي».
        </CardDescription>
      </CardHeader>
      <CardContent>
        {dueAt ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-destructive">الشركة هتتمسح يوم {day(dueAt)}.</p>
            <Button variant="outline" disabled={pending} onClick={() => run(cancelOrgDeletionAction, "اتلغى طلب الحذف")}>إلغاء طلب الحذف</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1 space-y-2">
              <Label htmlFor="del-name">اكتب اسم الشركة «{orgName}» للتأكيد</Label>
              <Input id="del-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </div>
            <Button variant="destructive" disabled={pending || name.trim() !== orgName.trim()}
              onClick={() => run(() => requestOrgDeletionAction(name), `الشركة هتتمسح بعد ${graceDays} يوم`)}>
              اطلب حذف الشركة
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
