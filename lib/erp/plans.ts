import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orgSubscriptions, organizationMembers, documentAttachments } from "@/db/schema";

/** Subscription caps for an org (snapshot on the subscription row). null = unlimited. */
export async function orgLimits(orgId: string): Promise<{ maxUsers: number | null; storageGb: number | null }> {
  const [sub] = await db
    .select({ maxUsers: orgSubscriptions.maxUsers, storageGb: orgSubscriptions.storageGb })
    .from(orgSubscriptions)
    .where(eq(orgSubscriptions.organizationId, orgId))
    .limit(1);
  return { maxUsers: sub?.maxUsers ?? null, storageGb: sub?.storageGb ?? null };
}

/** Active member seats used by an org. */
export async function orgActiveMemberCount(orgId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.isActive, true)));
  return r?.n ?? 0;
}

/** Bytes of attachments stored by an org. */
export async function orgStorageBytes(orgId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${documentAttachments.fileSize}),0)::bigint` })
    .from(documentAttachments)
    .where(eq(documentAttachments.organizationId, orgId));
  return Number(r?.n ?? 0);
}

const GB = 1024 ** 3;

/** Arabic error if adding one more active member would exceed the plan, else null. */
export async function seatLimitError(orgId: string): Promise<string | null> {
  const { maxUsers } = await orgLimits(orgId);
  if (maxUsers == null) return null; // unlimited
  const used = await orgActiveMemberCount(orgId);
  if (used >= maxUsers) return `تم بلوغ حد المستخدمين في الباقة (${maxUsers}). قم بترقية الاشتراك.`;
  return null;
}

/** Arabic error if storing `addBytes` more would exceed the plan, else null. */
export async function storageLimitError(orgId: string, addBytes: number): Promise<string | null> {
  const { storageGb } = await orgLimits(orgId);
  if (storageGb == null) return null; // unlimited
  const used = await orgStorageBytes(orgId);
  if (used + addBytes > storageGb * GB) return `تم بلوغ حد التخزين في الباقة (${storageGb} جيجابايت). قم بترقية الاشتراك.`;
  return null;
}
