"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2, Upload, Pencil } from "lucide-react";
import { createPlatformAction, updatePlatformAction, togglePlatformActiveAction } from "@/app/actions/erp/platforms";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Platform = {
  id: string; name: string; code: string; integrationType: string; isActive: boolean;
  customerName: string | null; customerId: string | null;
  warehouseId: string | null; warehouseName: string | null;
  bankAccountId: string | null; bankName: string | null;
};
type Option = { id: string; nameAr: string };

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";
const TYPE_LABEL: Record<string, string> = { amazon: "أمازون (محلّل مخصص)", generic: "عام (CSV بربط أعمدة)" };

function PlatformDialog({
  platform, warehouses, bankAccounts, onClose,
}: {
  platform: Platform | null; warehouses: Option[]; bankAccounts: Option[]; onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isEdit = !!platform;
  const [name, setName] = useState(platform?.name ?? "");
  const [code, setCode] = useState(platform?.code ?? "");
  const [integrationType, setIntegrationType] = useState(platform?.integrationType ?? "generic");
  const [warehouseId, setWarehouseId] = useState(platform?.warehouseId ?? "");
  const [bankAccountId, setBankAccountId] = useState(platform?.bankAccountId ?? "");

  const save = () => {
    if (!name.trim()) return toast.error("أدخل اسم المنصة");
    if (!isEdit && !code.trim()) return toast.error("أدخل كود المنصة");
    start(async () => {
      const payload = { name, integrationType, defaultWarehouseId: warehouseId || null, bankAccountId: bankAccountId || null };
      const r = isEdit
        ? await updatePlatformAction(platform!.id, payload)
        : await createPlatformAction({ ...payload, code });
      if (r.ok) {
        toast.success(isEdit ? "تم تحديث المنصة" : "تم إنشاء المنصة وعميلها");
        onClose();
        router.refresh();
      } else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <DialogContent dir="rtl">
      <DialogHeader>
        <DialogTitle>{isEdit ? `تعديل ${platform!.name}` : "منصة بيع جديدة"}</DialogTitle>
        <DialogDescription>
          {isEdit ? "الكود غير قابل للتعديل بعد الإنشاء." : "سيُنشأ عميل تلقائيًا بنفس اسم المنصة وتُسجَّل مبيعاتها باسمه."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label>اسم المنصة</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="أمازون" /></div>
          <div className="space-y-2">
            <Label>الكود</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="AMAZON" disabled={isEdit} className="font-mono" />
          </div>
        </div>
        <div className="space-y-2">
          <Label>نوع التكامل (شكل ملف الاستيراد)</Label>
          <select className={selectCls} value={integrationType} onChange={(e) => setIntegrationType(e.target.value)}>
            <option value="generic">{TYPE_LABEL.generic}</option>
            <option value="amazon">{TYPE_LABEL.amazon}</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>المخزن الافتراضي</Label>
            <select className={selectCls} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">— بدون —</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>الحساب البنكي للتسويات</Label>
            <select className={selectCls} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              <option value="">— بدون —</option>
              {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
            </select>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function PlatformsManager({
  platforms, warehouses, bankAccounts, canManage,
}: {
  platforms: Platform[]; warehouses: Option[]; bankAccounts: Option[]; canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<{ open: boolean; platform: Platform | null }>({ open: false, platform: null });

  const toggle = (id: string) => start(async () => {
    const r = await togglePlatformActiveAction(id);
    if (r.ok) router.refresh(); else toast.error(r.error ?? "تعذّر التنفيذ");
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>المنصات</CardTitle>
            <CardDescription>كل منصة لها عميلها ومخزنها وحسابها البنكي، وتُستورد أوامرها إلى المبيعات.</CardDescription>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setDialog({ open: true, platform: null })}><Plus className="size-4" />منصة جديدة</Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {platforms.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
            لا توجد منصات — أضف منصتك الأولى (مثلًا أمازون).
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">المنصة</TableHead>
                <TableHead className="text-start">العميل</TableHead>
                <TableHead className="text-start">المخزن</TableHead>
                <TableHead className="text-start">البنك</TableHead>
                <TableHead className="text-start">الحالة</TableHead>
                <TableHead className="text-start">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {platforms.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/erp/platforms/${p.code.toLowerCase()}`} className="font-medium text-primary hover:underline">{p.name}</Link>
                    <div className="text-xs text-muted-foreground"><span className="font-mono">{p.code}</span> · {TYPE_LABEL[p.integrationType] ?? p.integrationType}</div>
                  </TableCell>
                  <TableCell>{p.customerName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{p.warehouseName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{p.bankName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell><Badge variant={p.isActive ? "default" : "secondary"}>{p.isActive ? "مفعّلة" : "موقوفة"}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/erp/platforms/${p.code.toLowerCase()}/import`}><Upload className="size-4" />استيراد</Link>
                      </Button>
                      {canManage && (
                        <>
                          <Button size="icon" variant="ghost" onClick={() => setDialog({ open: true, platform: p })} aria-label="تعديل"><Pencil className="size-4" /></Button>
                          <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggle(p.id)}>{p.isActive ? "إيقاف" : "تفعيل"}</Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog({ open: false, platform: null })}>
        {dialog.open && <PlatformDialog platform={dialog.platform} warehouses={warehouses} bankAccounts={bankAccounts} onClose={() => setDialog({ open: false, platform: null })} />}
      </Dialog>
    </Card>
  );
}
