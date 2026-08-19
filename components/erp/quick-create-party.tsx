"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveSupplierAction } from "@/app/actions/erp/suppliers";
import { saveCustomerAction } from "@/app/actions/erp/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export type NewParty = { id: string; nameAr: string };

/**
 * Add a supplier or customer without leaving the document you are writing.
 *
 * Name only — the code auto-generates and everything else (email, credit limit, payment
 * terms) has a sensible default and belongs on the full master-data screen. The point is
 * to not lose a half-typed order because the party is not on file yet.
 *
 * It calls the SAME save action the master-data screen uses, so validation, the auto-code
 * sequence and the unique-code retry are shared rather than reimplemented; the action
 * returns the new row so the caller can select it immediately.
 */
export function QuickCreateParty({
  kind,
  open,
  onOpenChange,
  initialName = "",
  onCreated,
}: {
  kind: "supplier" | "customer";
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Whatever was typed into the combobox — nobody should type the name twice. */
  initialName?: string;
  onCreated: (party: NewParty) => void;
}) {
  const isSupplier = kind === "supplier";
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [pending, start] = useTransition();

  // Reopening for a different search term must not show the previous one.
  useEffect(() => { if (open) { setName(initialName); setPhone(""); } }, [open, initialName]);

  const submit = () => {
    const nameAr = name.trim();
    if (nameAr.length < 2) { toast.error("اكتب الاسم أولاً"); return; }
    start(async () => {
      const fd = new FormData();
      fd.set("nameAr", nameAr);
      if (phone.trim()) fd.set("phone", phone.trim());
      const r = isSupplier ? await saveSupplierAction({}, fd) : await saveCustomerAction({}, fd);
      if (!r.ok || !r.created) { toast.error(r.error ?? "تعذّر الحفظ"); return; }
      toast.success(isSupplier ? "تم إضافة المورد" : "تم إضافة العميل");
      onCreated(r.created);
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isSupplier ? "مورد جديد" : "عميل جديد"}</DialogTitle>
          <DialogDescription>
            الاسم يكفي — الكود يتولّد تلقائياً، وباقي البيانات تُستكمل لاحقاً من صفحة
            {isSupplier ? " الموردين" : " العملاء"}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>الاسم</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
              placeholder={isSupplier ? "اسم المورد" : "اسم العميل"}
            />
          </div>
          <div className="space-y-2">
            <Label>الهاتف <span className="text-xs text-muted-foreground">(اختياري)</span></Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
              dir="ltr"
              placeholder="01xxxxxxxxx"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>إلغاء</Button>
          <Button onClick={submit} disabled={pending}>{pending ? "جارٍ الحفظ…" : "حفظ واختيار"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
