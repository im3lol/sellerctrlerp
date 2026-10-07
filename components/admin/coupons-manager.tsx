"use client";

import { useState, useTransition } from "react";
import type { Locale } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { Loader2, Plus, Trash2, Pencil } from "lucide-react";
import { upsertCouponAction, toggleCouponAction, deleteCouponAction } from "@/app/actions/admin/coupons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectCls } from "@/lib/utils";

export type Coupon = { id: string; code: string; description: string; discountType: string; value: number; isActive: boolean; maxRedemptions: number | null; redemptions: number; expiresAt: string };

const fmtVal = (c: Coupon, locale: Locale) => c.discountType === "PERCENT" ? `${c.value}%` : locale === "en" ? `${c.value.toLocaleString("en-US")} off` : `${c.value.toLocaleString("ar-EG")} خصم`;

function EditDialog({ coupon, onClose }: { coupon: Coupon | null; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const isEdit = !!coupon;
  const [code, setCode] = useState(coupon?.code ?? "");
  const [description, setDescription] = useState(coupon?.description ?? "");
  const [discountType, setDiscountType] = useState(coupon?.discountType ?? "PERCENT");
  const [value, setValue] = useState(String(coupon?.value ?? ""));
  const [maxRedemptions, setMaxRedemptions] = useState(coupon?.maxRedemptions != null ? String(coupon.maxRedemptions) : "");
  const [expiresAt, setExpiresAt] = useState(coupon?.expiresAt ?? "");

  const save = () => start(async () => {
    const r = await upsertCouponAction({
      id: coupon?.id, code, description, discountType, value: Number(value) || 0,
      maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null, expiresAt: expiresAt || null,
    });
    if ("ok" in r) { toast.success("تم حفظ الكوبون"); onClose(); router.refresh(); }
    else toast.error(r.error);
  });

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{isEdit ? t("تعديل كوبون") : t("كوبون جديد")}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>{t("الكود")}</Label><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WELCOME20" disabled={isEdit} className="font-mono" /></div>
          <div className="space-y-1.5">
            <Label>{t("نوع الخصم")}</Label>
            <select className={selectCls} value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
              <option value="PERCENT">{t("نسبة %")}</option><option value="FIXED">{t("مبلغ ثابت")}</option>
            </select>
          </div>
          <div className="space-y-1.5"><Label>{t("القيمة")} {discountType === "PERCENT" ? "(%)" : ""}</Label><Input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>{t("حد الاستخدام")}</Label><Input type="number" min="1" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder={t("بلا حد")} /></div>
          <div className="space-y-1.5"><Label>{t("تاريخ الانتهاء")}</Label><Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label>{t("الوصف")}</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("اختياري")} /></div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{t("إلغاء")}</Button>
        <Button onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}{t("حفظ")}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function CouponsManager({ coupons }: { coupons: Coupon[] }) {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<{ open: boolean; coupon: Coupon | null }>({ open: false, coupon: null });
  const [confirmDel, setConfirmDel] = useState<Coupon | null>(null);

  const toggle = (id: string) => start(async () => { const r = await toggleCouponAction(id); if ("ok" in r) router.refresh(); else toast.error(r.error); });
  const del = (c: Coupon) => start(async () => { const r = await deleteCouponAction(c.id); if ("ok" in r) { toast.success("تم الحذف"); setConfirmDel(null); router.refresh(); } else toast.error(r.error); });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between p-4">
          <span className="text-sm text-muted-foreground">{coupons.length} {t("كوبون · إجمالي الاستخدامات:")} <span className="font-semibold text-foreground tabular-nums">{coupons.reduce((s, c) => s + (c.redemptions || 0), 0)}</span></span>
          <Button size="sm" onClick={() => setDialog({ open: true, coupon: null })}><Plus className="size-4" />{t("كوبون جديد")}</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-start">{t("الكود")}</TableHead>
              <TableHead className="text-start">{t("الخصم")}</TableHead>
              <TableHead className="text-start">{t("الاستخدام")}</TableHead>
              <TableHead className="text-start">{t("الانتهاء")}</TableHead>
              <TableHead className="text-start">{t("الحالة")}</TableHead>
              <TableHead className="text-start">{t("إجراءات")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {coupons.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">{t("لا توجد كوبونات.")}</TableCell></TableRow>
            ) : coupons.map((c) => (
              <TableRow key={c.id}>
                <TableCell><span className="font-mono font-medium">{c.code}</span>{c.description && <div className="text-xs text-muted-foreground">{t(c.description)}</div>}</TableCell>
                <TableCell>{fmtVal(c, locale)}</TableCell>
                <TableCell className="text-sm">{c.redemptions}{c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : ""}</TableCell>
                <TableCell className="text-sm">{c.expiresAt || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell><Badge variant={c.isActive ? "default" : "outline"}>{c.isActive ? t("مفعّل") : t("موقوف")}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setDialog({ open: true, coupon: c })} aria-label={t("تعديل")}><Pencil className="size-4" /></Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggle(c.id)}>{c.isActive ? t("إيقاف") : t("تفعيل")}</Button>
                    <Button size="icon" variant="ghost" disabled={pending} onClick={() => setConfirmDel(c)} aria-label={t("حذف")}><Trash2 className="size-4 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog({ open: false, coupon: null })}>
        {dialog.open && <EditDialog coupon={dialog.coupon} onClose={() => setDialog({ open: false, coupon: null })} />}
      </Dialog>
      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        {confirmDel && (
          <DialogContent>
            <DialogHeader><DialogTitle>{t("حذف الكوبون «")}{confirmDel.code}{t("»؟")}</DialogTitle></DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDel(null)}>{t("إلغاء")}</Button>
              <Button variant="destructive" disabled={pending} onClick={() => del(confirmDel)}>{t("حذف")}</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
