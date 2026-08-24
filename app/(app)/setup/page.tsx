import Link from "next/link";
import { loadErpPage } from "@/lib/erp/org";
import { getSetupStatus } from "@/lib/erp/setup-status";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SetupChecklist } from "@/components/erp/setup-checklist";
import { RepairAccountingButton } from "@/components/erp/repair-accounting-button";
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
        {(!status.chart || !status.warehouses) && (
          <div className="flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="font-medium text-destructive">التهيئة المحاسبية غير مكتملة</p>
              <p className="text-sm text-muted-foreground">لم يكتمل إنشاء دليل الحسابات أو المستودع الافتراضي عند التسجيل. اضغط للإصلاح — الإجراء آمن ولا يمسّ أي بيانات موجودة.</p>
            </div>
            <RepairAccountingButton />
          </div>
        )}
        <SetupChecklist status={status} />
      </div>
    );
  });
}
