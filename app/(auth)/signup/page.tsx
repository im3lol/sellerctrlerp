import { asc, eq } from "drizzle-orm";
import { Check } from "lucide-react";
import { db } from "@/lib/db";
import { plans } from "@/db/schema";
import { Logo } from "@/components/brand/logo";
import { SignupWizard } from "@/components/auth/signup-wizard";

export const revalidate = 3600;

const POINTS = ["إعداد شركتك ودليل حساباتك في دقائق", "١٤ يوماً مجاناً بكل الوحدات", "بدون بطاقة ائتمان — ألغِ في أي وقت"];

export default async function SignupPage() {
  const rows = await db.select().from(plans).where(eq(plans.isActive, true))
    .orderBy(asc(plans.sortOrder), asc(plans.priceMonthly)).catch(() => []);
  const catalog = rows.map((p) => ({
    name: p.name, priceMonthly: Number(p.priceMonthly), priceAnnual: Number(p.priceAnnual),
    maxUsers: p.maxUsers, storageGb: p.storageGb, modules: p.enabledModules ?? [],
  }));

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.4fr]">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <Logo className="text-4xl text-primary-foreground" />
        <div className="space-y-5">
          <h2 className="text-3xl font-bold leading-tight">ابدأ إدارة تجارتك في دقائق</h2>
          <p className="text-primary-foreground/80">أنشئ حساب شركتك وجرّب النظام كاملاً مجاناً — المحاسبة والمخزون والمبيعات والمشتريات ومنصات البيع.</p>
          <ul className="space-y-3 pt-2">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-primary"><Check className="size-3.5" strokeWidth={3} /></span>
                <span className="text-primary-foreground/90">{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-primary-foreground/60">© {new Date().getFullYear()} SellerCtrl. جميع الحقوق محفوظة.</p>
      </div>

      {/* Wizard panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          <div className="mb-8 flex justify-center lg:hidden"><Logo className="text-4xl text-primary" /></div>
          <SignupWizard plans={catalog} />
        </div>
      </div>
    </div>
  );
}
