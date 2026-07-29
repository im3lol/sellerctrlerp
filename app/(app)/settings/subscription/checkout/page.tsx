"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Zap, Lock, ArrowRight } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initXpayElements } from "@/lib/saas/xpay-elements";

const BRAND_PRIMARY = "#0A33D1"; // ponytail: SellerCtrl blue — matches --primary; change here if the brand color moves
const egp = (n: number) => `${n.toLocaleString("ar-EG")} ج.م`;

type Checkout = { confirm: (o: Record<string, unknown>) => Promise<{ type: "success" | "error"; error?: { message?: string } }> };
type Stashed = { clientSecret: string; publishableKey: string; planName: string; amount: number; interval: string };

export default function XpayCheckoutPage() {
  const router = useRouter();
  const [data, setData] = useState<Stashed | null>(null);
  const [email, setEmail] = useState("");
  const [canPay, setCanPay] = useState(false);
  const [mounting, setMounting] = useState(true);
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const checkoutRef = useRef<Checkout | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const raw = typeof window !== "undefined" ? sessionStorage.getItem("xpay_checkout") : null;
    if (!raw) { router.replace("/settings/subscription"); return; }
    const parsed = JSON.parse(raw) as Stashed;
    setData(parsed);
    if (started.current) return;
    started.current = true;
    const dark = document.documentElement.classList.contains("dark");
    initXpayElements({
      publishableKey: parsed.publishableKey, clientSecret: parsed.clientSecret, mountSelector: "#payment-element",
      colorPrimary: BRAND_PRIMARY, colorMode: dark ? "dark" : "light", onChange: setCanPay,
    })
      .then((c) => { checkoutRef.current = c as Checkout; setMounting(false); })
      .catch((e) => { setMounting(false); setErr(e instanceof Error ? e.message : "تعذّر تحميل نموذج الدفع"); });
  }, [router]);

  const pay = async () => {
    if (!checkoutRef.current) return;
    if (!email.includes("@")) { setErr("أدخل بريدًا إلكترونيًا صحيحًا"); return; }
    setPaying(true); setErr(null);
    try {
      const r = await checkoutRef.current.confirm({ customerDetails: { email: email.trim() }, redirect: "if_required" });
      if (r.type === "success") {
        sessionStorage.removeItem("xpay_checkout");
        toast.success("تم الدفع بنجاح ✅");
        router.replace("/settings/subscription?xpay=paid");
      } else {
        setErr(r.error?.message ?? "فشل الدفع — تحقق من بيانات البطاقة");
        setPaying(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "تعذّر إتمام الدفع");
      setPaying(false);
    }
  };

  const intervalLabel = data?.interval === "ANNUAL" ? "سنوي" : "شهري";

  return (
    <div className="mx-auto max-w-4xl py-4">
      <div className="grid overflow-hidden rounded-3xl border shadow-sm md:grid-cols-2">
        {/* Brand panel */}
        <div className="relative flex flex-col justify-between gap-8 bg-primary p-8 text-primary-foreground">
          <div className="absolute inset-0 opacity-20" style={{ background: "radial-gradient(120% 120% at 100% 0%, #ffffff55 0%, transparent 45%)" }} />
          <div className="relative">
            <Logo className="text-2xl text-primary-foreground" />
            <div className="mt-8 text-sm opacity-80">إتمام الاشتراك</div>
            <div className="mt-1 text-xl font-bold">{data ? `باقة ${data.planName}` : "…"}</div>
            <div className="mt-4 text-4xl font-black tabular-nums">{data ? egp(data.amount) : ""}</div>
            <div className="text-sm opacity-80">{data ? `اشتراك ${intervalLabel}` : ""}</div>
          </div>
          <ul className="relative space-y-3 text-sm">
            <li className="flex items-center gap-2"><Zap className="size-4" />تفعيل فوري بعد الدفع</li>
            <li className="flex items-center gap-2"><ShieldCheck className="size-4" />دفع آمن ومشفّر عبر xpay</li>
            <li className="flex items-center gap-2"><Lock className="size-4" />بياناتك البنكية لا تُخزَّن عندنا</li>
          </ul>
        </div>

        {/* Payment panel */}
        <div className="space-y-5 bg-card p-8">
          <h1 className="text-lg font-bold">بيانات الدفع</h1>
          <div className="space-y-1.5">
            <Label htmlFor="email">البريد الإلكتروني <span className="text-muted-foreground">(لإيصال الدفع)</span></Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" dir="ltr" />
          </div>

          <div className="space-y-1.5">
            <Label>بيانات البطاقة</Label>
            <div className="min-h-[3rem] rounded-xl border p-3">
              {mounting && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />جارٍ تحميل نموذج الدفع الآمن…</div>}
              <div id="payment-element" />
            </div>
          </div>

          {err && <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</div>}

          <Button onClick={pay} disabled={paying || mounting || !canPay || !email} size="lg" className="w-full">
            {paying ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
            {data ? `ادفع ${egp(data.amount)}` : "ادفع"}
          </Button>

          <button type="button" onClick={() => router.replace("/settings/subscription")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowRight className="size-4" />الرجوع للباقات
          </button>
          <div className="pt-2 text-center text-xs text-muted-foreground">مدعوم بأمان من xpay · وضع اختبار عند استخدام مفاتيح test</div>
        </div>
      </div>
    </div>
  );
}
