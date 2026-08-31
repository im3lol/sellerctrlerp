"use server";

import { cookies } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withPlatformScope } from "@/lib/db-scope";
import { organizations, users, orgSubscriptions, platformCredentials } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { ACTIVE_ORG_COOKIE } from "@/lib/erp/org";
import { revalidatePath } from "@/lib/safe-revalidate";
import { log } from "@/lib/log";
import { validatePassword } from "@/lib/auth/password-policy";
import { createOrgWithOwner } from "@/lib/erp/org-bootstrap";
import { initializeAccountingForOrg } from "@/lib/erp/default-chart";
import { computeWipeSet } from "@/lib/erp/tenant-reset";
import { setSubscriptionAction } from "@/app/actions/admin/licensing";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Permanently delete a tenant organization AND all of its data. Every org-scoped
 * table has an `organization_id` FK with ON DELETE CASCADE, so a single delete on
 * `organizations` removes everything (documents, accounting, inventory, members,
 * subscriptions, credentials…). IRREVERSIBLE.
 *
 * Guards: system_admin only (platform owner), and the exact org name must be typed
 * to confirm. If the deleted org happened to be the admin's active-org selection
 * (e.g. after «دخول للدعم»), the stale cookie is cleared so the session doesn't
 * point at a ghost org.
 *
 * ponytail: DB cascade only. Orphaned S3/MinIO objects (backup archives, uploaded
 * logos/attachments) are left — cheap storage; add a bucket sweep only if it matters.
 */
export async function deleteTenantAction(input: { orgId: string; confirmName: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "system_admin") return { ok: false, error: "غير مصرّح" };

  const [org] = await withPlatformScope(() =>
    db.select({ id: organizations.id, nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, input.orgId)).limit(1));
  if (!org) return { ok: false, error: "المؤسسة غير موجودة" };
  if (input.confirmName.trim() !== org.nameAr.trim()) return { ok: false, error: "اسم المؤسسة غير مطابق — اكتبه بالضبط للتأكيد" };

  console.warn(`[admin] system_admin ${user.id} permanently deleting org "${org.nameAr}" (${org.id})`);
  await withPlatformScope(() => db.delete(organizations).where(eq(organizations.id, org.id)));

  // Drop a stale active-org selection so the next request doesn't resolve a ghost org.
  const jar = await cookies();
  if (jar.get(ACTIVE_ORG_COOKIE)?.value === org.id) jar.delete(ACTIVE_ORG_COOKIE);

  revalidatePath("/admin/licensing");
  revalidatePath("/admin");
  return { ok: true };
}

/** Owner-only: create a new tenant (organization + owner login + 14-day trial +
 *  chart of accounts). The owner signs in with the email + password set here. */
export async function createTenantAction(input: {
  companyName: string; ownerName: string; email: string; password: string; phone?: string;
}): Promise<{ ok: true; orgId: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "system_admin") return { ok: false, error: "غير مصرّح" };

  const companyName = input.companyName?.trim() ?? "";
  const ownerName = input.ownerName?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  if (companyName.length < 2) return { ok: false, error: "اسم المؤسسة قصير جدًا" };
  if (ownerName.length < 2) return { ok: false, error: "اسم المالك قصير جدًا" };
  if (!emailRe.test(email)) return { ok: false, error: "بريد إلكتروني غير صالح" };
  const pwErr = validatePassword(input.password);
  if (pwErr) return { ok: false, error: pwErr };

  try {
    const orgId = await withPlatformScope(async () => {
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing) throw new Error("البريد الإلكتروني مستخدم بالفعل");
      const { orgId } = await createOrgWithOwner({ companyName, ownerName, email, password: input.password, phone: input.phone?.trim() || null, source: "admin" });
      await initializeAccountingForOrg(orgId);
      return orgId;
    });
    log.warn("admin.tenant_created", { by: user.id, orgId, name: companyName });
    revalidatePath("/admin/licensing");
    return { ok: true, orgId };
  } catch (e) {
    const msg = e instanceof Error && e.message === "البريد الإلكتروني مستخدم بالفعل" ? e.message : "تعذّر إنشاء المؤسسة";
    return { ok: false, error: msg };
  }
}

/** Owner-only: reset a tenant's DATA while keeping its identity (name, users,
 *  subscription, integrations). Always wipes operational data (documents, journals,
 *  stock, settlements…); `wipeMasterData` also clears the catalog/parties/chart and
 *  re-seeds a fresh chart of accounts. Typed-name confirmation, IRREVERSIBLE.
 *
 *  Enumerates every org-scoped table live and deletes the computed wipe set with a
 *  savepoint-per-table retry loop, so FK order never matters and the whole thing is
 *  atomic (one platform-scope transaction — any stuck table rolls the reset back). */
export async function resetTenantAction(input: { orgId: string; confirmName: string; wipeMasterData: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "system_admin") return { ok: false, error: "غير مصرّح" };

  try {
    return await withPlatformScope(async () => {
      const [org] = await db.select({ id: organizations.id, nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, input.orgId)).limit(1);
      if (!org) return { ok: false as const, error: "المؤسسة غير موجودة" };
      if (input.confirmName.trim() !== org.nameAr.trim()) return { ok: false as const, error: "اسم المؤسسة غير مطابق — اكتبه بالضبط للتأكيد" };

      const allOrgTables = (await db.execute<{ table_name: string }>(sql`
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'organization_id'`)).rows.map((r) => r.table_name);
      let remaining = computeWipeSet(allOrgTables, input.wipeMasterData);

      // Delete each table in its own savepoint; FK-blocked tables retry next pass once
      // whatever referenced them is gone. Terminates when a pass clears nothing.
      for (let pass = 0; remaining.length && pass <= remaining.length; pass++) {
        const stuck: string[] = [];
        for (const t of remaining) {
          try {
            await db.transaction(async (tx) => { await tx.execute(sql`DELETE FROM ${sql.identifier(t)} WHERE organization_id = ${org.id}`); });
          } catch { stuck.push(t); }
        }
        if (stuck.length && stuck.length === remaining.length) throw new Error(`تعذّر تصفير الجداول: ${stuck.join(", ")}`);
        remaining = stuck;
      }

      // A blank-slate reset drops the chart/warehouse/currency too — re-seed defaults.
      if (input.wipeMasterData) await initializeAccountingForOrg(org.id);

      log.warn("admin.tenant_reset", { by: user.id, orgId: org.id, name: org.nameAr, wipeMasterData: input.wipeMasterData });
      revalidatePath("/admin/licensing");
      return { ok: true as const };
    });
  } catch (e) {
    log.error("admin.tenant_reset_failed", { orgId: input.orgId, err: e });
    return { ok: false, error: e instanceof Error ? e.message : "تعذّر تصفير البيانات" };
  }
}

/** Owner-only quick status flip (suspend / reactivate) — reuses setSubscriptionAction so
 *  MRR movement is logged correctly. Carries the org's existing plan/entitlement over. */
export async function setTenantStatusAction(input: { orgId: string; status: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "system_admin") return { ok: false, error: "غير مصرّح" };

  const sub = await withPlatformScope(() =>
    db.select().from(orgSubscriptions).where(eq(orgSubscriptions.organizationId, input.orgId)).limit(1));
  const s = sub[0];
  if (!s) return { ok: false, error: "لا يوجد اشتراك لهذه المؤسسة — استخدم «تعديل» أولًا" };

  const r = await setSubscriptionAction({
    organizationId: input.orgId, status: input.status,
    planId: s.planId, planName: s.planName, interval: s.interval, price: Number(s.price ?? 0),
    expiresAt: s.expiresAt ? new Date(s.expiresAt).toISOString().slice(0, 10) : null,
    enabledModules: s.enabledModules ?? [], maxUsers: s.maxUsers, storageGb: s.storageGb,
  });
  if ("error" in r) return { ok: false, error: r.error };
  revalidatePath("/admin/licensing");
  return { ok: true };
}

/** Owner-only: Noon Express (FBPI) eligibility for one org — deliberately not a tenant
 *  self-service toggle (see the column comment on platformCredentials.noonExpressEnabled).
 *  Requires the org to have already connected a Noon account (the normal read-only flow). */
export async function setNoonExpressAction(input: { orgId: string; enabled: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "system_admin") return { ok: false, error: "غير مصرّح" };

  const updated = await withPlatformScope(() =>
    db.update(platformCredentials).set({ noonExpressEnabled: input.enabled })
      .where(and(eq(platformCredentials.organizationId, input.orgId), eq(platformCredentials.provider, "noon")))
      .returning({ id: platformCredentials.id }));
  if (!updated.length) return { ok: false, error: "المؤسسة لسه مربوطاش حساب نون" };

  log.warn("admin.noon_express_toggled", { by: user.id, orgId: input.orgId, enabled: input.enabled });
  revalidatePath(`/admin/tenants/${input.orgId}`);
  return { ok: true };
}
