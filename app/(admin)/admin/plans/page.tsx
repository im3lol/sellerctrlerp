import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { plans } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { PlansManager } from "@/components/admin/plans-manager";

export default async function PlansPage() {
  const rows = await db.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.name));
  const list = rows.map((p) => ({
    id: p.id, name: p.name, priceMonthly: Number(p.priceMonthly), priceAnnual: Number(p.priceAnnual),
    enabledModules: p.enabledModules ?? [], maxUsers: p.maxUsers, storageGb: p.storageGb,
    isActive: p.isActive, sortOrder: p.sortOrder,
  }));
  return (
    <div className="space-y-6">
      <PageHeader title="الباقات" description="خطط الاشتراك: الوحدات المضمّنة وحدود المستخدمين والتخزين والأسعار." />
      <PlansManager plans={list} />
    </div>
  );
}
