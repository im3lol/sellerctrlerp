"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Check, Copy, MessageCircle, CreditCard } from "lucide-react";
import { requestSubscriptionAction, startXpaySubscriptionAction } from "@/app/actions/erp/subscription";
import { openXpayDropIn } from "@/lib/saas/xpay-dropin";
import { MODULE_LABELS } from "@/lib/erp/module-list";
import { PAYMENT_METHODS, WALLET_NUMBER, SUPPORT_WHATSAPP } from "@/lib/erp/payment-info";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectCls } from "@/lib/utils";

export type PlanCard = { id: string; name: string; priceMonthly: number; priceAnnual: number; enabledModules: string[]; maxUsers: number | null; storageGb: number | null };
export type Account = { orgName: string; userName: string; email: string };

const egp = (n: number) => `${n.toLocaleString("ar-EG")} ج.م`;
const cap = (n: number | null, unit: string) => (n == null ? "بلا حد" : `${n.toLocaleString("ar-EG")} ${unit}`);
// Effective monthly price + % saved when billed annually.
const effMonthly = (p: PlanCard, annual: boolean) => (annual ? Math.round(p.priceAnnual / 12) : p.priceMonthly);
const discountPct = (p: PlanCard) => (p.priceMonthly > 0 ? Math.round((1 - p.priceAnnual / (p.priceMonthly * 12)) * 100) : 0);

function SubscribeDialog({ plan, account, interval, xpayEnabled, onClose }: { plan: PlanCard; account: Account; interval: "MONTHLY" | "ANNUAL"; xpayEnabled: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const methods = PAYMENT_METHODS.filter((m) => m.enabled && (m.key !== "XPAY" || xpayEnabled));
  const [method, setMethod] = useState<string>(methods[0]!.key);
  const [reference, setReference] = useState("");
  const annual = interval === "ANNUAL";
  const price = annual ? plan.priceAnnual : plan.priceMonthly;
  const chosen = methods.find((m) => m.key === method)!;
  const isXpay = method === "XPAY";

  // Open WhatsApp support prefilled with the account + plan details for the
  // post-transfer handoff (payment is verified manually by support).
  const openWhatsApp = () => {
    const lines = [
      "مرحبًا، أرغب في تفعيل اشتراك SellerCtrl بعد التحويل 👇",
      `• الشركة: ${account.orgName}`,
      `• الاسم: ${account.userName}`,
      `• البريد: ${account.email}`,
      `• الباقة: ${plan.name} — ${interval === "ANNUAL" ? "سنوي" : "شهري"}`,
      `• المبلغ: ${egp(price)}`,
      `• طريقة الدفع: ${chosen.label}`,
      `• مرجع التحويل: ${reference.trim() || "—"}`,
    ];
    window.open(`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  };

  const submit = () => start(async () => {
    if (isXpay) {
      const r = await startXpaySubscriptionAction({ planId: plan.id, interval });
      if (!("ok" in r)) { toast.error(r.error); return; }
      if (r.mode === "redirect") { window.location.href = r.url; return; } // hosted fallback
      // Drop-in: pay inside a modal on our own domain; the webhook activates the sub.
      try {
        await openXpayDropIn({
          publishableKey: r.publishableKey,
          clientSecret: r.clientSecret,
          onComplete: () => { toast.success("تم الدفع بنجاح — يتم تفعيل اشتراكك خلال لحظات ✅"); onClose(); router.refresh(); },
        });
      } catch (e) { toast.error(e instanceof Error ? e.message : "تعذّر فتح نافذة الدفع"); }
      return;
    }
    const r = await requestSubscriptionAction({ planId: plan.id, interval, paymentMethod: method, paymentReference: reference });
    if ("ok" in r) {
      openWhatsApp();
      toast.success("تم إرسال الطلب — أكمل مع الدعم على واتساب لتفعيل الاشتراك");
      onClose(); router.refresh();
    } else toast.error(r.error);
  });

  return (
    <DialogContent dir="rtl">
      <DialogHeader>
        <DialogTitle>الاشتراك في باقة {plan.name}</DialogTitle>
        <DialogDescription>{isXpay ? "ادفع أونلاين ويُفعَّل اشتراكك فور نجاح الدفع." : "حوّل قيمة الباقة على الرقم، ثم تابع مع الدعم على واتساب لتفعيل اشتراكك."}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>طريقة الدفع</Label>
          <select className={selectCls} value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </div>

        <div className="rounded-xl border bg-muted/30 p-3 text-sm">
          <div className="mb-1 font-medium">المبلغ: {egp(price)} <span className="font-normal text-muted-foreground">({annual ? "سنوي" : "شهري"})</span></div>
          <p className="text-muted-foreground">{chosen.detail}</p>
          {(method === "INSTAPAY" || method === "VODAFONE") && (
            <button type="button" onClick={() => { navigator.clipboard?.writeText(WALLET_NUMBER); toast.success("تم نسخ الرقم"); }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 font-mono text-base font-semibold hover:bg-accent" dir="ltr">
              {WALLET_NUMBER}<Copy className="size-3.5" />
            </button>
          )}
        </div>

        {isXpay ? (
          <p className="text-xs text-muted-foreground">سنحوّلك إلى صفحة دفع xpay الآمنة لإكمال الدفع بالبطاقة أو المحفظة أو فوري — ويُفعَّل اشتراكك تلقائيًا بعد الدفع.</p>
        ) : (
          <div className="space-y-1.5">
            <Label>رقم/مرجع عملية الدفع <span className="text-muted-foreground">(اختياري)</span></Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="رقم التحويل من إنستا باي أو المحفظة" />
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        {isXpay ? (
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
            ادفع الآن
          </Button>
        ) : (
          <Button onClick={submit} disabled={pending} className="bg-[#25D366] text-white hover:bg-[#20bd5a]">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <MessageCircle className="size-4" />}
            متابعة عبر واتساب
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

export function SubscriptionPlans({ plans, currentPlanId, canSubscribe, hasPending, account, xpayEnabled, xpayResult }: { plans: PlanCard[]; currentPlanId: string | null; canSubscribe: boolean; hasPending: boolean; account: Account; xpayEnabled: boolean; xpayResult?: string }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<PlanCard | null>(null);
  const [annual, setAnnual] = useState(false);

  // Return from xpay (?xpay=paid|pending, read server-side): show the result once,
  // then strip the query param.
  useEffect(() => {
    if (!xpayResult) return;
    if (xpayResult === "paid") toast.success("تم الدفع وتفعيل الاشتراك بنجاح ✅");
    else toast.info("جارٍ تأكيد الدفع — سيُفعَّل اشتراكك خلال لحظات.");
    router.replace("/settings/subscription");
    router.refresh();
  }, [xpayResult, router]);

  if (plans.length === 0) return <p className="text-sm text-muted-foreground">لا توجد باقات متاحة حالياً — تواصل مع الدعم.</p>;
  const topPct = Math.max(0, ...plans.map(discountPct));

  return (
    <>
      {/* Monthly / annual toggle */}
      <div className="mb-5 flex justify-center">
        <div className="inline-flex items-center rounded-full border bg-card p-1 text-sm">
          <button type="button" onClick={() => setAnnual(false)} className={`rounded-full px-5 py-1.5 font-medium transition ${!annual ? "bg-primary text-primary-foreground" : ""}`}>شهري</button>
          <button type="button" onClick={() => setAnnual(true)} className={`flex items-center gap-1.5 rounded-full px-5 py-1.5 font-medium transition ${annual ? "bg-primary text-primary-foreground" : ""}`}>
            سنوي
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${annual ? "bg-primary-foreground/20" : "bg-emerald-500/15 text-emerald-600"}`}>وفّر حتى {topPct}%</span>
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.id === currentPlanId;
          const eff = effMonthly(p, annual);
          const pct = discountPct(p);
          return (
            <Card key={p.id} className={isCurrent ? "border-primary ring-1 ring-primary" : ""}>
              <CardContent className="space-y-3 pt-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold">{p.name}</h3>
                  {isCurrent && <Badge>باقتك الحالية</Badge>}
                </div>
                <div className="text-2xl font-bold tabular-nums">{egp(eff)}<span className="text-sm font-normal text-muted-foreground"> / شهر</span></div>
                {annual
                  ? <div className="flex flex-wrap items-center gap-2 text-xs"><s className="text-muted-foreground tabular-nums">{egp(p.priceMonthly)}</s><span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-600">وفّر {pct}%</span><span className="text-muted-foreground">يُدفع {egp(p.priceAnnual)} سنوياً</span></div>
                  : <div className="text-xs text-muted-foreground">أو {egp(p.priceAnnual)} سنوياً — وفّر {pct}%</div>}
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
        {chosen && <SubscribeDialog plan={chosen} account={account} interval={annual ? "ANNUAL" : "MONTHLY"} xpayEnabled={xpayEnabled} onClose={() => setChosen(null)} />}
      </Dialog>
    </>
  );
}
