import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getPlatformData } from "@/lib/erp/platform-data";
import { ALL_MODULES, MODULE_LABELS } from "@/lib/erp/entitlements";
import { PageHeader } from "@/components/page-header";
import { CustomersTable } from "@/components/admin/licensing-manager";

export default async function CustomersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/platform/login");
  if (user.role !== "system_admin") redirect("/dashboard");

  const { customers } = await getPlatformData();
  const moduleOptions = ALL_MODULES.map((m) => ({ key: m, label: MODULE_LABELS[m] }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="إدارة العملاء"
        description="كل المؤسسات المسجّلة في المنصّة مع حالة اشتراكها والموديولات المتاحة."
      />
      <CustomersTable customers={customers} moduleOptions={moduleOptions} />
    </div>
  );
}
