import { requireErpModule } from "@/lib/erp/org";
import { ErpModulePlaceholder } from "@/components/erp/module-placeholder";

export default async function ErpDashboardPage() {
  await requireErpModule("reports.view");
  return (
    <ErpModulePlaceholder
      icon="LayoutDashboard"
      title="لوحة ERP"
      description="نظرة شاملة على المالية والمخزون والمبيعات والمشتريات."
      features={[
        "مؤشرات مالية فورية",
        "أرصدة المخزون والمستودعات",
        "ملخص المبيعات والمشتريات",
        "تنبيهات الفترات المحاسبية",
      ]}
    />
  );
}
