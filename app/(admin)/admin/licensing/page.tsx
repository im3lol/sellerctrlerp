import { eq, and, asc, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, orgSubscriptions, plans, subscriptionRequests, organizationMembers, documentAttachments } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { LicensingManager } from "@/components/admin/licensing-manager";
import { RequestsPanel } from "@/components/admin/requests-panel";

// (admin) layout already restricts to system_admin.
export default async function LicensingPage() {
  const rows = await db
    .select({
      id: organizations.id, name: organizations.nameAr,
      status: orgSubscriptions.status, planId: orgSubscriptions.planId, planName: orgSubscriptions.planName, interval: orgSubscriptions.interval,
      price: orgSubscriptions.price, expiresAt: orgSubscriptions.expiresAt, enabledModules: orgSubscriptions.enabledModules,
      maxUsers: orgSubscriptions.maxUsers, storageGb: orgSubscriptions.storageGb,
    })
    .from(organizations)
    .leftJoin(orgSubscriptions, eq(orgSubscriptions.organizationId, organizations.id))
    .orderBy(organizations.nameAr);

  // Per-org usage (members + storage) in one grouped query each.
  const memberRows = await db.select({ orgId: organizationMembers.organizationId, n: sql<number>`count(*)::int` })
    .from(organizationMembers).where(eq(organizationMembers.isActive, true)).groupBy(organizationMembers.organizationId);
  const storageRows = await db.select({ orgId: documentAttachments.organizationId, b: sql<number>`coalesce(sum(${documentAttachments.fileSize}),0)::bigint` })
    .from(documentAttachments).groupBy(documentAttachments.organizationId);
  const memberMap = new Map(memberRows.map((r) => [r.orgId, Number(r.n)]));
  const storageMap = new Map(storageRows.map((r) => [r.orgId, Number(r.b)]));

  const orgs = rows.map((r) => ({
    id: r.id, name: r.name, status: r.status ?? "NONE", planId: r.planId ?? "", planName: r.planName ?? "", interval: r.interval ?? "",
    price: Number(r.price ?? 0), enabledModules: r.enabledModules ?? [],
    maxUsers: r.maxUsers, storageGb: r.storageGb,
    members: memberMap.get(r.id) ?? 0, storageBytes: storageMap.get(r.id) ?? 0,
    expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString().slice(0, 10) : "",
  }));

  const planRows = await db.select().from(plans).where(eq(plans.isActive, true)).orderBy(asc(plans.sortOrder), asc(plans.name));
  const catalog = planRows.map((p) => ({
    id: p.id, name: p.name, priceMonthly: Number(p.priceMonthly), priceAnnual: Number(p.priceAnnual),
    enabledModules: p.enabledModules ?? [], maxUsers: p.maxUsers, storageGb: p.storageGb,
  }));

  const reqRows = await db
    .select({ id: subscriptionRequests.id, orgName: organizations.nameAr, planName: subscriptionRequests.planName, interval: subscriptionRequests.interval, price: subscriptionRequests.price, paymentMethod: subscriptionRequests.paymentMethod, paymentReference: subscriptionRequests.paymentReference, createdAt: subscriptionRequests.createdAt })
    .from(subscriptionRequests)
    .innerJoin(organizations, eq(organizations.id, subscriptionRequests.organizationId))
    .where(eq(subscriptionRequests.status, "PENDING"))
    .orderBy(desc(subscriptionRequests.createdAt));
  const requests = reqRows.map((r) => ({ id: r.id, orgName: r.orgName, planName: r.planName, interval: r.interval, price: Number(r.price), paymentMethod: r.paymentMethod, paymentReference: r.paymentReference ?? "", createdAt: new Date(r.createdAt).toISOString() }));

  return (
    <div className="space-y-6">
      <PageHeader title="التراخيص والتفعيل" description="اشتراكات المؤسسات، الوحدات المفعّلة، والاستهلاك (مستخدمون + تخزين)." />
      <RequestsPanel requests={requests} />
      <LicensingManager orgs={orgs} plans={catalog} />
    </div>
  );
}
