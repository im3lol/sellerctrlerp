import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { bankAccounts, bankStatementLines, accounts } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

const fmt = (n: number) =>
  n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function BankAccountsPage() {
  const { orgId, role } = await requireErpModule("accounting.view");

  const rows = await db
    .select({
      id: bankAccounts.id,
      nameAr: bankAccounts.nameAr,
      bankName: bankAccounts.bankName,
      accountNumber: bankAccounts.accountNumber,
      iban: bankAccounts.iban,
      isActive: bankAccounts.isActive,
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
    .where(eq(bankAccounts.organizationId, orgId))
    .groupBy(bankAccounts.id, accounts.id)
    .orderBy(bankAccounts.nameAr);

  const canEdit = erpCan(role, "accounting.create");

  return (
    <div className="space-y-6" dir="rtl">
      <ErpPageHeader
        icon="Landmark"
        title="الحسابات البنكية"
        subtitle="إدارة الحسابات البنكية وتسوية الكشوفات"
        backHref="/erp/accounting"
        action={
          canEdit ? (
            <Button asChild>
              <Link href="/erp/accounting/banks/new">
                <Icon name="Plus" className="size-4" />
                حساب بنكي جديد
              </Link>
            </Button>
          ) : undefined
        }
      />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
          لا توجد حسابات بنكية مضافة بعد.{" "}
          {canEdit && (
            <Link href="/erp/accounting/banks/new" className="text-primary underline underline-offset-2">
              إضافة حساب
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const balance = Number(r.stmtIn) - Number(r.stmtOut);
            const unrec = Number(r.unreconciled);
            return (
              <Card key={r.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="font-semibold">{r.nameAr}</p>
                      {r.bankName && <p className="text-xs text-muted-foreground">{r.bankName}</p>}
                      {r.iban && <p className="font-mono text-xs text-muted-foreground">{r.iban}</p>}
                      {r.glCode && (
                        <p className="text-xs text-muted-foreground">
                          حساب GL: {r.glCode} — {r.glName}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {!r.isActive && <Badge variant="outline">غير نشط</Badge>}
                      {unrec > 0 && (
                        <Badge variant="destructive" className="text-xs">{unrec} غير مسوّى</Badge>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 border-t pt-3">
                    <p className="text-xs text-muted-foreground">رصيد الكشف</p>
                    <p className={`text-lg font-bold tabular-nums ${balance < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {fmt(balance)} ﷼
                    </p>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <Button asChild variant="outline" size="sm" className="flex-1">
                      <Link href={`/erp/accounting/banks/${r.id}`}>
                        <Icon name="FileText" className="size-4" />
                        الكشف
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
