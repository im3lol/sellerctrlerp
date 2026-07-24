import Link from "next/link";
import { loadErpPage } from "@/lib/erp/org";
import { getSetupStatus } from "@/lib/erp/setup-status";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SetupChecklist } from "@/components/erp/setup-checklist";
import { Button } from "@/components/ui/button";

/** إعداد الحساب — checklist ذكي محسوب من بيانات المؤسسة الفعلية (يهبط عليه المسجّل الجديد). */
export default async function SetupPage() {
  return loadErpPage("sales.view", async ({ orgId }) => {
    const status = await getSetupStatus(orgId);
    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Rocket"
          title="أهلًا بك في SellerCtrl 👋"
          subtitle="خطوات قليلة ويبقى نظامك جاهزًا — كل خطوة تتعلّم تلقائيًا أول ما تنفّذها"
          action={<Button asChild variant="outline"><Link href="/dashboard">فتح لوحة التحكم</Link></Button>}
        />
        <SetupChecklist status={status} />
      </div>
    );
  });
}
