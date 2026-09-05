import "server-only";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users, organizations, organizationMembers, orgSubscriptions } from "@/db/schema";
import { BCRYPT_COST } from "@/lib/auth/password-policy";
import { ALL_MODULES } from "@/lib/erp/module-list";
import { TRIAL_DAYS } from "@/lib/erp/subscription";
import { generateOrgSlug } from "@/lib/erp/org-slug";

export type NewOrgInput = {
  companyName: string;
  ownerName: string;
  email: string;      // already lowercased/validated by the caller; must be unused
  password: string;   // already policy-checked by the caller
  phone?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  modules?: string[];
  source?: string | null;
};

/**
 * Bootstrap a brand-new tenant: the organization, its owner (org_admin), an admin
 * membership, and a 14-day TRIAL subscription over the chosen modules. Shared by
 * self-service signup and the admin "add organization" action so the bootstrap can't
 * drift between them.
 *
 * The caller MUST run this inside `withPlatformScope` (the new org has no session yet)
 * and MUST have already checked the email is free. Chart-of-accounts bootstrap
 * (`initializeAccountingForOrg`) is left to the caller — signup runs it best-effort,
 * the admin action runs it in the same transaction.
 */
export async function createOrgWithOwner(input: NewOrgInput): Promise<{ orgId: string; userId: string }> {
  const modules = (input.modules ?? []).filter((m) => (ALL_MODULES as readonly string[]).includes(m));
  const enabled = modules.length ? modules : [...ALL_MODULES]; // never lock a fresh trial out of everything

  const slug = await generateOrgSlug(input.companyName);
  const [org] = await db.insert(organizations).values({
    nameAr: input.companyName, nameEn: input.companyName, slug,
    email: input.email, phone: input.phone || null, address: input.address || null, taxNumber: input.taxNumber || null,
    signupSource: input.source || null,
  }).returning({ id: organizations.id });

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  const [user] = await db.insert(users).values({
    name: input.ownerName, email: input.email, passwordHash, passwordChangedAt: new Date(),
    role: "org_admin", title: "مدير المؤسسة",
  }).returning({ id: users.id });

  await db.insert(organizationMembers).values({ organizationId: org.id, userId: user.id, role: "admin" });

  const now = new Date();
  await db.insert(orgSubscriptions).values({
    organizationId: org.id, status: "TRIAL", planName: "تجربة مجانية",
    enabledModules: enabled, startedAt: now,
    expiresAt: new Date(now.getTime() + TRIAL_DAYS * 86_400_000),
  });

  return { orgId: org.id, userId: user.id };
}
