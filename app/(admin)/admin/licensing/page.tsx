import { eq, and, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, orgSubscriptions, plans } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { LicensingManager } from "@/components/admin/licensing-manager";

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

  const orgs = rows.map((r) => ({
    id: r.id, name: r.name, status: r.status ?? "NONE", planId: r.planId ?? "", planName: r.planName ?? "", interval: r.interval ?? "",
    price: Number(r.price ?? 0), enabledModules: r.enabledModules ?? [],
    maxUsers: r.maxUsers, storageGb: r.storageGb,
    expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString().slice(0, 10) : "",
  }));

  const planRows = await db.select().from(plans).where(eq(plans.isActive, true)).orderBy(asc(plans.sortOrder), asc(plans.name));
  const catalog = planRows.map((p) => ({
    id: p.id, name: p.name, priceMonthly: Number(p.priceMonthly), priceAnnual: Number(p.priceAnnual),
    enabledModules: p.enabledModules ?? [], maxUsers: p.maxUsers, storageGb: p.storageGb,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="التراخيص والتفعيل" description="إدارة اشتراك كل مؤسسة والوحدات المفعّلة لها." />
      <LicensingManager orgs={orgs} plans={catalog} />
    </div>
  );
}
