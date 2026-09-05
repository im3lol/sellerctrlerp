import { loadErpPage } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { MaintenanceManager } from "@/components/erp/maintenance-manager";
import { loadMaintenance } from "@/lib/erp/maintenance-queries";

export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  return loadErpPage("maintenance.view", async ({ orgId, can }) => {
    const data = await loadMaintenance(orgId, false);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Wrench"
          title="الصيانة"
          subtitle="صيانة قبل ما تقف، وأمر شغل بقطعه وتكلفته — على نفس أصول دفتر الأصول"
        />
        {data.assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            مفيش أصول مسجّلة. سجّل الآلة أو العربية في «الأصول الثابتة» الأول، وهي هتظهر هنا بعدد ساعاتها أو كيلومتراتها.
          </p>
        ) : (
          <MaintenanceManager {...data} canManage={can("maintenance.manage")} />
        )}
      </div>
    );
  });
}
