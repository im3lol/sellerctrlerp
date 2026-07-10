"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { db } from "@/lib/db";
import { eq as _eq } from "drizzle-orm";
import { users, organizations, organizationMembers, orgSubscriptions, plans, subscriptionRequests } from "@/db/schema";
import { ALL_MODULES } from "@/lib/erp/module-list";
import { TRIAL_DAYS } from "@/lib/erp/subscription";
import { PAYMENT_METHODS } from "@/lib/erp/payment-info";
import { initializeAccountingForOrg } from "@/lib/erp/default-chart";

export type SignupInput = {
  companyName: string;
  personName: string;
  email: string;
  phone?: string;
  address?: string;
  taxNumber?: string;
  password: string;
  modules: string[];
  // When the user picks a plan on the last step, a PENDING subscription request
  // is filed alongside the trial (owner activates it after confirming payment).
  subscribe?: { planId: string; interval: string; paymentMethod: string; paymentReference?: string } | null;
};

const schema = z.object({
  companyName: z.string().trim().min(2, "اسم الشركة قصير جداً"),
  personName: z.string().trim().min(2, "اسم المسؤول قصير جداً"),
  email: z.string().trim().toLowerCase().email("بريد إلكتروني غير صالح"),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  taxNumber: z.string().trim().optional(),
  password: z.string().min(8, "كلمة المرور 8 أحرف على الأقل"),
  modules: z.array(z.string()),
  subscribe: z.object({
    planId: z.string(),
    interval: z.enum(["MONTHLY", "ANNUAL"]),
    paymentMethod: z.string(),
    paymentReference: z.string().trim().optional(),
  }).nullish(),
});

/**
 * Self-service tenant signup: creates the company, its owner (org_admin), an
 * admin membership, and a 14-day TRIAL subscription over the chosen modules,
 * bootstraps the chart of accounts, then signs the owner in (redirects).
 */
export async function signupAction(input: SignupInput): Promise<{ error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, d.email)).limit(1);
  if (existing) return { error: "البريد الإلكتروني مستخدم بالفعل — سجّل الدخول بدلاً من ذلك" };

  const modules = d.modules.filter((m) => (ALL_MODULES as readonly string[]).includes(m));
  const enabled = modules.length ? modules : [...ALL_MODULES]; // never lock a fresh trial out of everything

  let orgId: string;
  try {
    const [org] = await db.insert(organizations).values({
      nameAr: d.companyName, nameEn: d.companyName,
      email: d.email, phone: d.phone || null, address: d.address || null, taxNumber: d.taxNumber || null,
    }).returning({ id: organizations.id });
    orgId = org.id;

    const passwordHash = await bcrypt.hash(d.password, 10);
    const [user] = await db.insert(users).values({
      name: d.personName, email: d.email, passwordHash, role: "org_admin", title: "مدير المؤسسة",
    }).returning({ id: users.id });

    await db.insert(organizationMembers).values({ organizationId: orgId, userId: user.id, role: "admin" });

    const now = new Date();
    await db.insert(orgSubscriptions).values({
      organizationId: orgId, status: "TRIAL", planName: "تجربة مجانية",
      enabledModules: enabled, startedAt: now,
      expiresAt: new Date(now.getTime() + TRIAL_DAYS * 86_400_000),
    });

    // Optional: file a PENDING subscription request for the chosen plan. The trial
    // above still grants immediate access while the owner confirms the payment.
    if (d.subscribe) {
      const method = PAYMENT_METHODS.find((m) => m.key === d.subscribe!.paymentMethod);
      const [plan] = await db.select().from(plans).where(_eq(plans.id, d.subscribe.planId)).limit(1);
      if (plan && plan.isActive && method?.enabled) {
        const price = d.subscribe.interval === "ANNUAL" ? plan.priceAnnual : plan.priceMonthly;
        await db.insert(subscriptionRequests).values({
          organizationId: orgId, planId: plan.id, planName: plan.name,
          interval: d.subscribe.interval, price: String(price),
          paymentMethod: d.subscribe.paymentMethod, paymentReference: d.subscribe.paymentReference?.trim() || null,
          requestedBy: user.id,
        });
      }
    }
  } catch {
    return { error: "تعذّر إنشاء الحساب — حاول مرة أخرى" };
  }

  // Best-effort chart-of-accounts bootstrap; the tenant can re-run it from settings if it fails.
  try { await initializeAccountingForOrg(orgId); } catch { /* non-fatal */ }

  try {
    await signIn("credentials", { email: d.email, password: d.password, redirectTo: "/dashboard" });
  } catch (error) {
    if (error instanceof AuthError) return { error: "تم إنشاء الحساب، لكن تعذّر تسجيل الدخول — جرّب من صفحة الدخول" };
    throw error; // NEXT_REDIRECT on success
  }
  return { error: "" };
}
