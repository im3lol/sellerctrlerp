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
import { upsertBankAccountAction } from "@/app/actions/erp/bank-accounts";

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

export default async function NewBankAccountPage() {
  const { orgId } = await requireErpModule("accounting.create");

  const glAccounts = await db
    .select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr })
    .from(accounts)
    .where(eq(accounts.organizationId, orgId))
    .orderBy(accounts.code);

  async function create(fd: FormData) {
    "use server";
    const res = await upsertBankAccountAction({
      nameAr:        String(fd.get("nameAr") ?? ""),
      bankName:      String(fd.get("bankName") ?? ""),
      accountNumber: String(fd.get("accountNumber") ?? ""),
      iban:          String(fd.get("iban") ?? ""),
      glAccountId:   String(fd.get("glAccountId") ?? ""),
      notes:         String(fd.get("notes") ?? ""),
    });
    if (res.ok && res.id) redirect(`/erp/accounting/banks/${res.id}`);
    redirect("/erp/accounting/banks");
  }

  return (
    <div className="space-y-6" dir="rtl">
      <ErpPageHeader
        icon="Landmark"
        title="حساب بنكي جديد"
        backHref="/erp/accounting/banks"
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">بيانات الحساب البنكي</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={create} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="nameAr">اسم الحساب *</Label>
              <Input id="nameAr" name="nameAr" required placeholder="مثال: البنك الأهلي — الحساب الرئيسي" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="bankName">اسم البنك</Label>
                <Input id="bankName" name="bankName" placeholder="البنك الأهلي السعودي" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="accountNumber">رقم الحساب</Label>
                <Input id="accountNumber" name="accountNumber" dir="ltr" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="iban">رقم الآيبان IBAN</Label>
              <Input id="iban" name="iban" dir="ltr" placeholder="SA…" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="glAccountId">حساب الأستاذ المرتبط</Label>
              <select id="glAccountId" name="glAccountId" className={selectCls}>
                <option value="">— اختر حسابًا —</option>
                {glAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.nameAr}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="notes">ملاحظات</Label>
              <Input id="notes" name="notes" />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit">حفظ</Button>
              <Button type="button" variant="ghost" asChild>
                <a href="/erp/accounting/banks">إلغاء</a>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
