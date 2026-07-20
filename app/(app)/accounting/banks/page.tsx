import Link from "next/link";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { bankAccounts, bankStatementLines, accounts } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { FilterBar, filterFieldCls } from "@/components/erp/filter-bar";
import { BanksTable } from "@/components/erp/banks-table";

const fmt = (n: number) =>
  n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type SP = { q?: string; active?: string };

export default async function BankAccountsPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("accounting.view", async ({ orgId, role, can }) => {
    const sp = await searchParams;
    const q = (sp.q ?? "").trim();
    const active = sp.active ?? "";

    const conds = [eq(bankAccounts.organizationId, orgId)];
    if (active === "1") conds.push(eq(bankAccounts.isActive, true));
    if (active === "0") conds.push(eq(bankAccounts.isActive, false));
    if (q) conds.push(or(ilike(bankAccounts.nameAr, `%${q}%`), ilike(bankAccounts.bankName, `%${q}%`))!);
    const hasFilters = !!(q || active);

    const rows = await db
      .select({
        id: bankAccounts.id,
        nameAr: bankAccounts.nameAr,
        bankName: bankAccounts.bankName,
        accountNumber: bankAccounts.accountNumber,
        iban: bankAccounts.iban,
        isActive: bankAccounts.isActive,
        glAccountId: bankAccounts.glAccountId,
        glCode: accounts.code,
        glName: accounts.nameAr,
        stmtIn: sql<string>`coalesce(sum(${bankStatementLines.debit}), 0)`,
        stmtOut: sql<string>`coalesce(sum(${bankStatementLines.credit}), 0)`,
        unreconciled: sql<number>`count(*) filter (where not ${bankStatementLines.isReconciled})`,
      })
      .from(bankAccounts)
      .leftJoin(accounts, eq(accounts.id, bankAccounts.glAccountId))
      .leftJoin(
        bankStatementLines,
        and(
          eq(bankStatementLines.bankAccountId, bankAccounts.id),
          eq(bankStatementLines.organizationId, orgId),
        ),
      )
      .where(and(...conds))
      .groupBy(bankAccounts.id, accounts.id)
      .orderBy(bankAccounts.nameAr);

    const canEdit = can("accounting.create");
    const totalBalance = rows.reduce((s, r) => s + (Number(r.stmtIn) - Number(r.stmtOut)), 0);

    // GL account options for the edit dialog (active leaf accounts).
    const glAccounts = canEdit
      ? await db.select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr }).from(accounts)
          .where(and(eq(accounts.organizationId, orgId), eq(accounts.isActive, true), eq(accounts.isLeaf, true)))
          .orderBy(accounts.code)
      : [];

    const bankRows = rows.map((r) => ({
      id: r.id, nameAr: r.nameAr, bankName: r.bankName, accountNumber: r.accountNumber, iban: r.iban,
      isActive: r.isActive, glAccountId: r.glAccountId, glCode: r.glCode, glName: r.glName,
      balance: Number(r.stmtIn) - Number(r.stmtOut),
    }));

    return (
      <div className="space-y-6" dir="rtl">
        <ErpPageHeader
          icon="Landmark"
          title="الحسابات البنكية"
          subtitle="إدارة الحسابات البنكية وتسوية الكشوفات"
          backHref="/accounting"
          action={
            canEdit ? (
              <Button asChild>
                <Link href="/accounting/banks/new">
                  <Icon name="Plus" className="size-4" />
                  حساب بنكي جديد
                </Link>
              </Button>
            ) : undefined
          }
        />

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">عدد الحسابات</div><div className="text-2xl font-bold tabular-nums">{rows.length.toLocaleString("ar-EG-u-nu-latn")}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">إجمالي أرصدة الكشوف</div><div className={`text-2xl font-bold tabular-nums ${totalBalance < 0 ? "text-destructive" : ""}`}>{fmt(totalBalance)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">حسابات نشطة</div><div className="text-2xl font-bold tabular-nums">{rows.filter((r) => r.isActive).length.toLocaleString("ar-EG-u-nu-latn")}</div></CardContent></Card>
        </div>

        <FilterBar active={hasFilters} clearHref="/accounting/banks">
          <div className="space-y-2">
            <Label htmlFor="q">بحث</Label>
            <Input id="q" name="q" defaultValue={q} placeholder="اسم الحساب أو البنك" className="min-w-56" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="active">الحالة</Label>
            <select id="active" name="active" defaultValue={active} className={`${filterFieldCls} min-w-32`}>
              <option value="">الكل</option>
              <option value="1">نشط</option>
              <option value="0">غير نشط</option>
            </select>
          </div>
        </FilterBar>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
            {hasFilters ? "لا توجد حسابات مطابقة للتصفية." : (
              <>لا توجد حسابات بنكية مضافة بعد.{" "}
              {canEdit && (
                <Link href="/accounting/banks/new" className="text-primary underline underline-offset-2">
                  إضافة حساب
                </Link>
              )}</>
            )}
          </div>
        ) : (
          <BanksTable rows={bankRows} accounts={glAccounts} canEdit={canEdit} />
        )}
      </div>
    );
  });
}
