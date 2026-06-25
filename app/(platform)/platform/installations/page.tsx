import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { installationLicenses } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { InstallationManager } from "@/components/admin/installation-manager";

export default async function InstallationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/platform/login");
  if (user.role !== "system_admin") redirect("/dashboard");

  const installs = await db
    .select()
    .from(installationLicenses)
    .orderBy(desc(installationLicenses.createdAt));

  return (
    <div className="space-y-6">
      <PageHeader
        title="التثبيتات On-Premises"
        description="إدارة تراخيص العملاء الذين يشغّلون النظام على سيرفراتهم الخاصة."
      />
      <InstallationManager installs={installs} />
    </div>
  );
}
