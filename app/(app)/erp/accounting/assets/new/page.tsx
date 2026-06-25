import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { createAssetAction } from "@/app/actions/erp/fixed-assets";

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

const CATEGORIES = [
  ["BUILDING", "مباني"], ["VEHICLE", "مركبات"], ["EQUIPMENT", "معدات"],
  ["FURNITURE", "أثاث"], ["IT", "تقنية المعلومات"], ["OTHER", "أخرى"],
];

export default async function NewFixedAssetPage() {
  const { orgId } = await requireErpModule("accounting.create");

  const glAccounts = await db
    .select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.organizationId, orgId))
    .orderBy(accounts.code);

  async function create(fd: FormData) {
    "use server";
    const res = await createAssetAction({
      code:            String(fd.get("code") ?? ""),
      nameAr:          String(fd.get("nameAr") ?? ""),
      category:        String(fd.get("category") ?? "OTHER"),
      purchaseDate:    String(fd.get("purchaseDate") ?? ""),
      purchaseCost:    Number(fd.get("purchaseCost") ?? 0),
      salvageValue:    Number(fd.get("salvageValue") ?? 0),
      usefulLifeYears: Number(fd.get("usefulLifeYears") ?? 5),
      glAssetAccountId:          String(fd.get("glAssetAccountId") ?? ""),
      glAccumDeprecAccountId:    String(fd.get("glAccumDeprecAccountId") ?? ""),
      glDeprecExpenseAccountId:  String(fd.get("glDeprecExpenseAccountId") ?? ""),
      notes: String(fd.get("notes") ?? ""),
    });
    if (res.ok && res.id) redirect(`/erp/accounting/assets/${res.id}`);
    redirect("/erp/accounting/assets");
  }

  return (
    <div className="space-y-6" dir="rtl">
      <ErpPageHeader icon="Building2" title="أصل ثابت جديد" backHref="/erp/accounting/assets" />

      <Card className="max-w-2xl">
        <CardHeader><CardTitle className="text-base">بيانات الأصل</CardTitle></CardHeader>
        <CardContent>
          <form action={create} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="code">الكود *</Label>
                <Input id="code" name="code" required placeholder="FA-001" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="category">التصنيف</Label>
                <select id="category" name="category" className={selectCls}>
                  {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="nameAr">اسم الأصل *</Label>
              <Input id="nameAr" name="nameAr" required placeholder="سيارة شركة / جهاز حاسوب…" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="purchaseDate">تاريخ الشراء *</Label>
                <Input id="purchaseDate" name="purchaseDate" type="date" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="purchaseCost">تكلفة الشراء *</Label>
                <Input id="purchaseCost" name="purchaseCost" type="number" step="0.01" min="0" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="salvageValue">القيمة التخريدية</Label>
                <Input id="salvageValue" name="salvageValue" type="number" step="0.01" min="0" defaultValue="0" />
              </div>
            </div>
            <div className="space-y-1 max-w-48">
              <Label htmlFor="usefulLifeYears">العمر الإنتاجي (سنوات)</Label>
              <Input id="usefulLifeYears" name="usefulLifeYears" type="number" min="1" max="50" defaultValue="5" />
            </div>

            <div className="pt-2">
              <p className="mb-3 text-sm font-medium text-muted-foreground">الحسابات المحاسبية (اختيارية — لترحيل الإهلاك تلقائيًا)</p>
              {[
                ["glAssetAccountId",         "حساب الأصل (بالميزانية)"],
                ["glAccumDeprecAccountId",   "حساب الإهلاك المتراكم"],
                ["glDeprecExpenseAccountId", "حساب مصروف الإهلاك"],
              ].map(([name, label]) => (
                <div key={name} className="mb-3 space-y-1">
                  <Label htmlFor={name}>{label}</Label>
                  <select id={name} name={name} className={selectCls}>
                    <option value="">— اختياري —</option>
                    {glAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} — {a.nameAr}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="space-y-1">
              <Label htmlFor="notes">ملاحظات</Label>
              <Input id="notes" name="notes" />
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit">حفظ الأصل</Button>
              <Button type="button" variant="ghost" asChild>
                <a href="/erp/accounting/assets">إلغاء</a>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
