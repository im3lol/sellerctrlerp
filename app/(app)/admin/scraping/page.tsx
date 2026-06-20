import { requireCapability } from "@/lib/session";
import { getAccessibleWorkspaces } from "@/lib/workspaces";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { ScrapingPanel } from "@/components/scraping/scraping-panel";

export default async function ScrapingPage() {
  const user = await requireCapability("product.review");
  const wsList = (await getAccessibleWorkspaces(user)).map((w) => ({ id: w.id, name: w.name }));

  return (
    <div>
      <PageHeader
        title="السحب الذكي"
        description="اسحب بيانات المنتجات الناقصة من مواقع العملاء عبر إضافة Edge وعامل Docker"
      />

      {/* How it works */}
      <Card className="mb-6 p-5">
        <h2 className="mb-3 font-semibold">كيف يعمل؟</h2>
        <ol className="space-y-2 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">1.</span> ارفع منتجات العميل عبر Excel في
            «وضع البيانات الناقصة (مسودة)» — يكفي لينك المنتج.
          </li>
          <li>
            <span className="font-medium text-foreground">2.</span> ثبّت إضافة{" "}
            <span className="font-mono" dir="ltr">edge-extension</span> على Edge، واضبط رابط المنصة
            ورمز السحب ومعرّف مساحة العمل.
          </li>
          <li>
            <span className="font-medium text-foreground">3.</span> من الإضافة: افتح أول منتج، اضغط
            «حدّد» بجوار كل حقل ثم اضغط على العنصر المقابل في الصفحة لالتقاط الـ selector.
          </li>
          <li>
            <span className="font-medium text-foreground">4.</span> «حفظ وتشغيل» — يشغّل عامل Docker
            السحب على كل المنتجات المسودة ويحفظ البيانات الناقصة أول بأول هنا.
          </li>
          <li>
            <span className="font-medium text-foreground">5.</span> راجع المنتجات المسودة وأكّدها
            لتظهر للموظفين.
          </li>
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          تعليمات التشغيل في المجلدين <span className="font-mono" dir="ltr">edge-extension/</span> و{" "}
          <span className="font-mono" dir="ltr">scraper-worker/</span>. لا بد أن يكون عامل Docker
          شغّالاً لتنفيذ المهام.
        </p>
      </Card>

      {wsList.length === 0 ? (
        <EmptyState icon="Bot" title="لا توجد مساحات عمل متاحة" />
      ) : (
        <ScrapingPanel workspaces={wsList} />
      )}
    </div>
  );
}
