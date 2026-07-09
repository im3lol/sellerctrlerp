"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { setSubscriptionAction } from "@/app/actions/admin/licensing";
import { ALL_MODULES, MODULE_LABELS } from "@/lib/erp/module-list";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type OrgSub = { id: string; name: string; status: string; planName: string; interval: string; price: number; enabledModules: string[]; expiresAt: string };

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";
const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ACTIVE: { label: "مفعّل", variant: "default" }, TRIAL: { label: "تجريبي", variant: "secondary" },
  EXPIRED: { label: "منتهٍ", variant: "destructive" }, CANCELLED: { label: "ملغى", variant: "destructive" },
  NONE: { label: "بلا اشتراك", variant: "outline" },
};

function EditDialog({ org, onClose }: { org: OrgSub; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(org.status);
  const [planName, setPlanName] = useState(org.planName);
  const [interval, setInterval] = useState(org.interval);
  const [price, setPrice] = useState(String(org.price));
  const [expiresAt, setExpiresAt] = useState(org.expiresAt);
  const [couponCode, setCouponCode] = useState("");
  const [modules, setModules] = useState<string[]>(org.enabledModules);

  const toggle = (m: string) => setModules((s) => s.includes(m) ? s.filter((x) => x !== m) : [...s, m]);
  const allOn = () => setModules([...ALL_MODULES]);

  const save = () => start(async () => {
    const r = await setSubscriptionAction({ organizationId: org.id, status, planName, interval: interval || null, price: Number(price) || 0, expiresAt: expiresAt || null, enabledModules: modules, couponCode: couponCode || null });
    if ("ok" in r) { toast.success(r.discounted != null ? `تم — بعد الخصم: ${r.discounted.toLocaleString("ar-EG")}` : "تم حفظ الاشتراك"); onClose(); router.refresh(); }
    else toast.error(r.error);
  });

  return (
    <DialogContent dir="rtl">
      <DialogHeader>
        <DialogTitle>ترخيص — {org.name}</DialogTitle>
        <DialogDescription>الحالة والوحدات المفعّلة وتاريخ الانتهاء. «مفعّل» بلا تاريخ انتهاء = دائم.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>الحالة</Label>
            <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label>تاريخ الانتهاء</Label><Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>اسم الباقة</Label><Input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Pro" /></div>
          <div className="space-y-1.5">
            <Label>الدورة</Label>
            <select className={selectCls} value={interval} onChange={(e) => setInterval(e.target.value)}>
              <option value="">—</option><option value="MONTHLY">شهري</option><option value="ANNUAL">سنوي</option>
            </select>
          </div>
          <div className="space-y-1.5"><Label>السعر / الدورة</Label><Input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>كوبون خصم</Label><Input value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} placeholder="اختياري" className="font-mono" /></div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between"><Label>الوحدات المفعّلة</Label><button type="button" onClick={allOn} className="text-xs text-primary hover:underline">تفعيل الكل</button></div>
          <div className="grid grid-cols-2 gap-2 rounded-xl border p-3 sm:grid-cols-3">
            {ALL_MODULES.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={modules.includes(m)} onChange={() => toggle(m)} className="size-4" />
                {MODULE_LABELS[m] ?? m}
              </label>
            ))}
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

export function LicensingManager({ orgs }: { orgs: OrgSub[] }) {
  const [editing, setEditing] = useState<OrgSub | null>(null);
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-start">المؤسسة</TableHead>
              <TableHead className="text-start">الحالة</TableHead>
              <TableHead className="text-start">الباقة</TableHead>
              <TableHead className="text-start">الانتهاء</TableHead>
              <TableHead className="text-start">الوحدات</TableHead>
              <TableHead className="text-start">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orgs.map((o) => {
              const st = STATUS[o.status] ?? STATUS.NONE;
              return (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.name}</TableCell>
                  <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                  <TableCell>{o.planName || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-sm">{o.expiresAt || <span className="text-muted-foreground">بلا انتهاء</span>}</TableCell>
                  <TableCell className="text-sm">{o.status === "NONE" ? "الكل (افتراضي)" : `${o.enabledModules.length}/${ALL_MODULES.length}`}</TableCell>
                  <TableCell><Button size="sm" variant="outline" onClick={() => setEditing(o)}>تعديل / تفعيل</Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <EditDialog key={editing.id} org={editing} onClose={() => setEditing(null)} />}
      </Dialog>
    </Card>
  );
}
