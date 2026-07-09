import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, orgSubscriptions } from "@/db/schema";
import { LicensingManager } from "@/components/admin/licensing-manager";

// (admin) layout already restricts to system_admin.
export default async function LicensingPage() {
  const rows = await db
    .select({
      id: organizations.id, name: organizations.nameAr,
      status: orgSubscriptions.status, planName: orgSubscriptions.planName, interval: orgSubscriptions.interval,
      price: orgSubscriptions.price, expiresAt: orgSubscriptions.expiresAt, enabledModules: orgSubscriptions.enabledModules,
    })
    .from(organizations)
    .leftJoin(orgSubscriptions, eq(orgSubscriptions.organizationId, organizations.id))
    .orderBy(organizations.nameAr);

  const orgs = rows.map((r) => ({
    id: r.id, name: r.name, status: r.status ?? "NONE", planName: r.planName ?? "", interval: r.interval ?? "",
    price: Number(r.price ?? 0), enabledModules: r.enabledModules ?? [],
    expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString().slice(0, 10) : "",
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">التراخيص والتفعيل</h1>
        <p className="text-muted-foreground">إدارة اشتراك كل مؤسسة والوحدات المفعّلة لها.</p>
      </div>
      <LicensingManager orgs={orgs} />
    </div>
  );
}
