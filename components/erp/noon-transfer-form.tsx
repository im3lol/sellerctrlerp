"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { recordNoonTransferAction } from "@/app/actions/erp/noon-payments";

// Manual entry for a Noon payout (Noon has no settlement API). Posts one "Transfer"
// through the settlement engine → Dr bank / Cr Noon wallet, then refreshes the page
// so the wallet balance + transfers table reflect it.
export function NoonTransferForm({ today }: { today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await recordNoonTransferAction({ date, amount: Number(amount), reference });
      if (r.ok) {
        toast.success("تم تسجيل التحويل");
        setAmount(""); setReference("");
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label htmlFor="t-date">تاريخ التحويل</Label><Input id="t-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" className="w-44" required /></div>
          <div className="space-y-1"><Label htmlFor="t-amount">المبلغ المُحوَّل</Label><Input id="t-amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-40" placeholder="0.00" required /></div>
          <div className="space-y-1"><Label htmlFor="t-ref">مرجع التحويل</Label><Input id="t-ref" value={reference} onChange={(e) => setReference(e.target.value)} className="w-56" placeholder="رقم الإيداع / كشف البنك" required /></div>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}تسجيل تحويل من نون
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">نون ماعندهاش API للتسويات، فبتسجّل التحويل يدويًا هنا — يُرحَّل تلقائيًا: مدين البنك / دائن محفظة نون، وينقص رصيد المحفظة.</p>
      </CardContent>
    </Card>
  );
}
