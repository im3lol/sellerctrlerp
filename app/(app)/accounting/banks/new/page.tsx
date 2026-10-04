import { redirect } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { upsertBankAccountAction } from "@/app/actions/erp/bank-accounts";
import { FormCombobox } from "@/components/erp/form-combobox";

export default async function NewBankAccountPage() {
  const t = await getT();
  return loadErpPage("accounting.create", async ({ orgId }) => {
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
      if (res.ok && res.id) redirect(`/accounting/banks/${res.id}`);
      redirect("/accounting/banks");
    }

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Landmark"
          title={t("حساب بنكي جديد")}
          backHref="/accounting/banks"
        />

        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle className="text-base">{t("بيانات الحساب البنكي")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={create} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="nameAr">{t("اسم الحساب *")}</Label>
                <Input id="nameAr" name="nameAr" required placeholder={t("مثال: البنك الأهلي — الحساب الرئيسي")} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="bankName">{t("اسم البنك")}</Label>
                  <Input id="bankName" name="bankName" placeholder={t("البنك الأهلي السعودي")} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="accountNumber">{t("رقم الحساب")}</Label>
                  <Input id="accountNumber" name="accountNumber" dir="ltr" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="iban">{t("رقم الآيبان IBAN")}</Label>
                <Input id="iban" name="iban" dir="ltr" placeholder="SA…" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="glAccountId">{t("حساب الأستاذ المرتبط")}</Label>
                <FormCombobox
                  name="glAccountId"
                  placeholder={t("ابحث عن حساب…")}
                  options={glAccounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.nameAr}` }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="notes">{t("ملاحظات")}</Label>
                <Input id="notes" name="notes" />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit">{t("حفظ")}</Button>
                <Button type="button" variant="ghost" asChild>
                  <Link href="/accounting/banks">{t("إلغاء")}</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  });
}
