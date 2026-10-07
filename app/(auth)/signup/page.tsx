import { redirect } from "next/navigation";
import { fill } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { asc, eq } from "drizzle-orm";
import { Check } from "lucide-react";
import { db } from "@/lib/db";
import { plans } from "@/db/schema";
import { Logo } from "@/components/brand/logo";
import { LocaleToggle } from "@/components/brand/locale-toggle";
import { SignupWizard } from "@/components/auth/signup-wizard";
import { TRIAL_DAYS } from "@/lib/erp/trial";

// Dynamic so the SIGNUP_OPEN gate below is read per request — a statically prerendered
// page bakes the redirect at build time, making the env toggle a no-op until a rebuild.
export const dynamic = "force-dynamic";


export default async function SignupPage() {
  const t = await getT();
  // Self-serve signup is closed by default — the landing routes leads through
  // "request a demo" (WhatsApp) instead. Reopen with SIGNUP_OPEN=1 (no deploy).
  if (process.env.SIGNUP_OPEN !== "1") redirect("/");

  const rows = await db.select().from(plans).where(eq(plans.isActive, true))
    .orderBy(asc(plans.sortOrder), asc(plans.priceMonthly)).catch(() => []);
  const catalog = rows.map((p) => ({
    id: p.id, name: p.name, priceMonthly: Number(p.priceMonthly), priceAnnual: Number(p.priceAnnual),
    maxUsers: p.maxUsers, storageGb: p.storageGb, modules: p.enabledModules ?? [],
  }));

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.4fr]">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <Logo className="text-4xl" variant="white" />
        <div className="space-y-5">
          <h2 className="text-3xl font-bold leading-tight">{t("ابدأ إدارة تجارتك في دقائق")}</h2>
          <p className="text-primary-foreground/80">{t("أنشئ حساب شركتك وجرّب النظام كاملاً مجاناً — المحاسبة والمخزون والمبيعات والمشتريات ومنصات البيع.")}</p>
          <ul className="space-y-3 pt-2">
            {[t("إعداد شركتك ودليل حساباتك في دقائق"), fill(t("{0} يوماً مجاناً بكل الوحدات"), [TRIAL_DAYS]), t("بدون بطاقة ائتمان — ألغِ في أي وقت")].map((p) => (
              <li key={p} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-primary"><Check className="size-3.5" strokeWidth={3} /></span>
                <span className="text-primary-foreground/90">{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-primary-foreground/60">© {new Date().getFullYear()} SellerCtrl. {t("جميع الحقوق محفوظة.")}</p>
      </div>

      {/* Wizard panel */}
      <div className="relative flex items-center justify-center p-6">
        <LocaleToggle className="absolute end-4 top-4" />
        <div className="w-full max-w-2xl">
          <div className="mb-8 flex justify-center lg:hidden"><Logo className="text-4xl text-primary" /></div>
          <SignupWizard plans={catalog} />
        </div>
      </div>
    </div>
  );
}
