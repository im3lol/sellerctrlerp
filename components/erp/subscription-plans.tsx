"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Check, Copy } from "lucide-react";
import { requestSubscriptionAction } from "@/app/actions/erp/subscription";
import { MODULE_LABELS } from "@/lib/erp/module-list";
import { PAYMENT_METHODS, WALLET_NUMBER } from "@/lib/erp/payment-info";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type PlanCard = { id: string; name: string; priceMonthly: number; priceAnnual: number; enabledModules: string[]; maxUsers: number | null; storageGb: number | null };

const egp = (n: number) => `${n.toLocaleString("ar-EG")} ج.م`;
const cap = (n: number | null, unit: string) => (n == null ? "بلا حد" : `${n.toLocaleString("ar-EG")} ${unit}`);
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";

function SubscribeDialog({ plan, onClose }: { plan: PlanCard; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [interval, setInterval] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [method, setMethod] = useState<string>(PAYMENT_METHODS.find((m) => m.enabled)!.key);
  const [reference, setReference] = useState("");
  const price = interval === "ANNUAL" ? plan.priceAnnual : plan.priceMonthly;
  const chosen = PAYMENT_METHODS.find((m) => m.key === method)!;

  const submit = () => start(async () => {
    const r = await requestSubscriptionAction({ planId: plan.id, interval, paymentMethod: method, paymentReference: reference });
    if ("ok" in r) { toast.success("تم إرسال طلب الاشتراك — سيتم تفعيله بعد مراجعة الدفع"); onClose(); router.refresh(); }
    else toast.error(r.error);
  });

  return (
    <DialogContent dir="rtl">
      <DialogHeader>
        <DialogTitle>الاشتراك في باقة {plan.name}</DialogTitle>
        <DialogDescription>اختر الدورة وطريقة الدفع، ثم أرسل الطلب ليتم تفعيله بعد مراجعة الدفع.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>الدورة</Label>
            <select className={selectCls} value={interval} onChange={(e) => setInterval(e.target.value as "MONTHLY" | "ANNUAL")}>
              <option value="MONTHLY">شهري — {egp(plan.priceMonthly)}</option>
              <option value="ANNUAL">سنوي — {egp(plan.priceAnnual)}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>طريقة الدفع</Label>
            <select className={selectCls} value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.filter((m) => m.enabled).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
        </div>

        <div className="rounded-xl border bg-muted/30 p-3 text-sm">
          <div className="mb-1 font-medium">المبلغ: {egp(price)}</div>
          <p className="text-muted-foreground">{chosen.detail}</p>
          {method === "INSTAPAY" && (
            <button type="button" onClick={() => { navigator.clipboard?.writeText(WALLET_NUMBER); toast.success("تم نسخ الرقم"); }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 font-mono text-base font-semibold hover:bg-accent" dir="ltr">
              {WALLET_NUMBER}<Copy className="size-3.5" />
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>رقم/مرجع عملية الدفع <span className="text-muted-foreground">(اختياري)</span></Label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="رقم التحويل من إنستا باي أو البنك" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button onClick={submit} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}إرسال الطلب</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function SubscriptionPlans({ plans, currentPlanId, canSubscribe, hasPending }: { plans: PlanCard[]; currentPlanId: string | null; canSubscribe: boolean; hasPending: boolean }) {
  const [chosen, setChosen] = useState<PlanCard | null>(null);
  if (plans.length === 0) return <p className="text-sm text-muted-foreground">لا توجد باقات متاحة حالياً — تواصل مع الدعم.</p>;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.id === currentPlanId;
          return (
            <Card key={p.id} className={isCurrent ? "border-primary ring-1 ring-primary" : ""}>
              <CardContent className="space-y-3 pt-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold">{p.name}</h3>
                  {isCurrent && <Badge>باقتك الحالية</Badge>}
                </div>
                <div className="text-2xl font-bold tabular-nums">{egp(p.priceMonthly)}<span className="text-sm font-normal text-muted-foreground"> / شهر</span></div>
                <div className="text-xs text-muted-foreground">أو {egp(p.priceAnnual)} سنوياً</div>
                <ul className="space-y-1.5 text-sm">
                  <li className="flex items-center gap-2"><Check className="size-4 text-primary" />حتى {cap(p.maxUsers, "مستخدم")}</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-primary" />تخزين {cap(p.storageGb, "جيجابايت")}</li>
                  {p.enabledModules.map((m) => (
                    <li key={m} className="flex items-center gap-2"><Check className="size-4 text-primary" />{MODULE_LABELS[m] ?? m}</li>
                  ))}
                </ul>
                <Button className="w-full" variant={isCurrent ? "outline" : "default"} disabled={!canSubscribe || hasPending} onClick={() => setChosen(p)}>
                  {isCurrent ? "تجديد / ترقية" : "اشترك"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {!canSubscribe && <p className="mt-3 text-sm text-muted-foreground">صلاحية مدير المؤسسة مطلوبة لطلب الاشتراك.</p>}
      {hasPending && <p className="mt-3 text-sm text-amber-600">لديك طلب قيد المراجعة — لا يمكن إرسال طلب جديد حتى تتم مراجعته.</p>}
      <Dialog open={!!chosen} onOpenChange={(o) => !o && setChosen(null)}>
        {chosen && <SubscribeDialog plan={chosen} onClose={() => setChosen(null)} />}
      </Dialog>
    </>
  );
}
