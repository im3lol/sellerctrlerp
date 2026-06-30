import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { desktopLicenses, organizations } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { DesktopLicenseManager } from "@/components/admin/desktop-license-manager";

export default async function DesktopLicensesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/platform/login");
  if (user.role !== "system_admin") redirect("/dashboard");

  const licenses = await db
    .select({
      id: desktopLicenses.id,
      tokenHint: desktopLicenses.tokenHint,
      organizationId: desktopLicenses.organizationId,
      orgName: organizations.nameAr,
      enabledModules: desktopLicenses.enabledModules,
      status: desktopLicenses.status,
      expiresAt: desktopLicenses.expiresAt,
      lastHeartbeatAt: desktopLicenses.lastHeartbeatAt,
      notes: desktopLicenses.notes,
      createdAt: desktopLicenses.createdAt,
    })
    .from(desktopLicenses)
    .leftJoin(organizations, eq(organizations.id, desktopLicenses.organizationId))
    .orderBy(desc(desktopLicenses.createdAt));

  const orgs = await db
    .select({ id: organizations.id, name: organizations.nameAr })
    .from(organizations)
    .orderBy(organizations.nameAr);

  return (
    <div className="space-y-6">
      <PageHeader
        title="تراخيص Desktop"
        description="إدارة تراخيص تطبيق SellerCtrl Desktop — كل توكن يُولَّد مرّة واحدة ويُخزَّن كـ hash فقط."
      />
      <DesktopLicenseManager licenses={licenses} orgs={orgs} />
    </div>
  );
}
