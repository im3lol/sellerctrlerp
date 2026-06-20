import { requireErpModule } from "@/lib/erp/org";
import { ErpModulePlaceholder } from "@/components/erp/module-placeholder";

export default async function ErpSettingsPage() {
  await requireErpModule("settings.edit");
  return (
    <ErpModulePlaceholder
      icon="Settings"
      title="إعدادات ERP"
      description="إعداد المؤسسة والعملات ووحدات القياس والضبط المحاسبي."
      features={[
        "بيانات المؤسسة (المحاسبية)",
        "العملات وأسعار الصرف",
        "وحدات القياس",
        "الضبط المحاسبي الافتراضي",
      ]}
    />
  );
}
