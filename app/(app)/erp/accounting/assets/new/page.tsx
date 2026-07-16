import { redirect } from "next/navigation";
import Link from "next/link";
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
import { FormCombobox } from "@/components/erp/form-combobox";

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

const CATEGORIES = [
  ["BUILDING", "مباني"], ["VEHICLE", "مركبات"], ["EQUIPMENT", "معدات"],
  ["FURNITURE", "أثاث"], ["IT", "تقنية المعلومات"], ["OTHER", "أخرى"],
];

export default async function NewFixedAssetPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { orgId } = await requireErpModule("accounting.create");
  const { error } = await searchParams;

  const glAccounts = await db
    .select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.organizationId, orgId))
    .orderBy(accounts.code);

  // What can credit an asset purchase: cash/bank, or a payable if bought on credit.
  const fundingAccounts = glAccounts.filter(
    (a) => /^(1101|1102)/.test(a.code) || (a.type === "LIABILITY" && /^21/.test(a.code)),
  );

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
      acquisition:     fd.get("acquisition") === "CAPITALIZE" ? "CAPITALIZE" : "EXISTING",
      fundingAccountId: String(fd.get("fundingAccountId") ?? ""),
      notes: String(fd.get("notes") ?? ""),
    });
    if (res.ok && res.id) redirect(`/erp/accounting/assets/${res.id}`);
    // Bounce back with the reason. This used to redirect to the list on failure,
    // discarding the error — which now matters, since capitalizing refuses rather
    // than silently registering the asset without its entry.
    redirect(`/erp/accounting/assets/new?error=${encodeURIComponent(res.error ?? "تعذّر حفظ الأصل")}`);
  }

  return (
    <div className="space-y-6" dir="rtl">
      <ErpPageHeader icon="Building2" title="أصل ثابت جديد" backHref="/erp/accounting/assets" />

      <Card className="max-w-2xl">
        <CardHeader><CardTitle className="text-base">بيانات الأصل</CardTitle></CardHeader>
        <CardContent>
          {error && (
            <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
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

            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
              <p className="text-sm font-medium">تسجيل الاقتناء محاسبيًا</p>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="radio" name="acquisition" value="EXISTING" defaultChecked className="mt-1" />
                <span>
                  <span className="font-medium">الأصل مُسجَّل بالفعل في الدفاتر</span>
                  <span className="block text-xs text-muted-foreground">
                    رصيد افتتاحي من نظام قديم، أو اشتريته بفاتورة شراء مُرحَّلة. لا يُرحَّل قيد — لأن الأصل وثمنه مسجّلان بالفعل، وترحيله تاني هيحسبهم مرتين.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="radio" name="acquisition" value="CAPITALIZE" className="mt-1" />
                <span>
                  <span className="font-medium">شراء جديد — رحّل قيد الاقتناء</span>
                  <span className="block text-xs text-muted-foreground">
                    يُرحَّل: حساب الأصل مدين بالتكلفة، وحساب السداد دائن. يتطلّب حساب الأصل وحساب السداد أدناه.
                  </span>
                </span>
              </label>
              <div className="space-y-1 pt-1">
                <Label htmlFor="fundingAccountId">حساب السداد (عند الشراء الجديد)</Label>
                <FormCombobox
                  name="fundingAccountId"
                  placeholder="النقدية / البنك / الدائنون…"
                  options={fundingAccounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.nameAr}` }))}
                />
              </div>
            </div>

            <div className="pt-2">
              <p className="mb-3 text-sm font-medium text-muted-foreground">الحسابات المحاسبية (مطلوبة لترحيل الإهلاك — وحساب الأصل مطلوب للاقتناء)</p>
              {[
                ["glAssetAccountId",         "حساب الأصل (بالميزانية)"],
                ["glAccumDeprecAccountId",   "حساب الإهلاك المتراكم"],
                ["glDeprecExpenseAccountId", "حساب مصروف الإهلاك"],
              ].map(([name, label]) => (
                <div key={name} className="mb-3 space-y-1">
                  <Label htmlFor={name}>{label}</Label>
                  <FormCombobox
                    name={name}
                    placeholder="ابحث عن حساب… (اختياري)"
                    options={glAccounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.nameAr}` }))}
                  />
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
                <Link href="/erp/accounting/assets">إلغاء</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
