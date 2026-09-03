"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { validatePassword } from "@/lib/auth/password-policy";
import { db } from "@/lib/db";
import { withPlatformScope } from "@/lib/db-scope";
import { log } from "@/lib/log";
import { eq as _eq } from "drizzle-orm";
import { users, plans, subscriptionRequests } from "@/db/schema";
import { PAYMENT_METHODS } from "@/lib/erp/payment-info";
import { createOrgWithOwner } from "@/lib/erp/org-bootstrap";
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
  source?: string; // acquisition attribution (utm/referrer), captured client-side
};

const schema = z.object({
  companyName: z.string().trim().min(2, "اسم الشركة قصير جداً"),
  personName: z.string().trim().min(2, "اسم المسؤول قصير جداً"),
  email: z.string().trim().toLowerCase().email("بريد إلكتروني غير صالح"),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  taxNumber: z.string().trim().optional(),
  password: z.string().superRefine((p, ctx) => { const e = validatePassword(p); if (e) ctx.addIssue({ code: z.ZodIssueCode.custom, message: e }); }),
  modules: z.array(z.string()),
  source: z.string().trim().max(80).optional(),
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
  // Self-serve signup is closed (see signup/page.tsx). Reopen with SIGNUP_OPEN=1.
  if (process.env.SIGNUP_OPEN !== "1") return { error: "التسجيل الذاتي مغلق حاليًا — اطلب ديمو وسنتواصل معك عبر واتساب." };
  // Throttle abuse: at most 5 signup attempts per IP per hour.
  const { headers } = await import("next/headers");
  const { rateLimit, clientIp } = await import("@/lib/rate-limit");
  const ip = clientIp(await headers());
  if (!rateLimit(`signup:${ip}`, 5, 3_600_000)) return { error: "محاولات كثيرة — انتظر قليلاً ثم حاول مجددًا." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, d.email)).limit(1);
  if (existing) return { error: "البريد الإلكتروني مستخدم بالفعل — سجّل الدخول بدلاً من ذلك" };

  let orgId: string;
  try {
    // Provisioning a brand-new tenant writes RLS-policied rows (members,
    // subscription) for an org that has no session/scope yet → platform scope.
    orgId = await withPlatformScope(async () => {
      const { orgId, userId } = await createOrgWithOwner({
        companyName: d.companyName, ownerName: d.personName, email: d.email, password: d.password,
        phone: d.phone, address: d.address, taxNumber: d.taxNumber, modules: d.modules, source: d.source,
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
            requestedBy: userId,
          });
        }
      }
      return orgId;
    });
  } catch {
    return { error: "تعذّر إنشاء الحساب — حاول مرة أخرى" };
  }

  // Best-effort chart-of-accounts bootstrap (writes policied tables → platform scope);
  // the tenant can re-run it from settings if it fails.
  // Non-fatal to signup, but NOT silent: if the chart-of-accounts bootstrap fails the
  // org lands with an incomplete chart and every posting dead-ends until it's re-run
  // from settings — so log it loudly (hits the error sink) instead of swallowing.
  try { await withPlatformScope(() => initializeAccountingForOrg(orgId)); }
  catch (e) { log.error("signup.accounting_bootstrap_failed", { orgId, err: e }); }

  // Best-effort welcome email (no-op if email isn't configured; never blocks signup).
  try {
    const { sendEmail } = await import("@/lib/erp/email");
    const { welcomeEmail } = await import("@/lib/saas/email-templates");
    const mail = welcomeEmail({ name: d.personName, orgName: d.companyName, appUrl: process.env.APP_URL || "" });
    await sendEmail({ to: d.email, subject: mail.subject, html: mail.html, text: mail.text });
  } catch { /* non-fatal */ }

  try {
    await signIn("credentials", { email: d.email, password: d.password, redirectTo: "/setup" });
  } catch (error) {
    if (error instanceof AuthError) return { error: "تم إنشاء الحساب، لكن تعذّر تسجيل الدخول — جرّب من صفحة الدخول" };
    throw error; // NEXT_REDIRECT on success
  }
  return { error: "" };
}
