import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accountBudgets } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

const fmt = (v: number) => v.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function BudgetIndexPage() {
  const { orgId } = await requireErpModule("accounting.view");

  const years = await db
    .select({
      year: accountBudgets.year,
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${accountBudgets.amount}),0)`,
    })
    .from(accountBudgets)
    .where(eq(accountBudgets.organizationId, orgId))
    .groupBy(accountBudgets.year)
    .orderBy(sql`${accountBudgets.year} desc`);

  const currentYear = new Date().getFullYear();

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Target"
        title="الميزانية التقديرية"
        subtitle="إدخال الميزانية السنوية لكل حساب ومقارنتها بالفعلي"
        action={
          <Button asChild>
            <Link href={`/erp/accounting/budget/${currentYear}`}>
              <Icon name="Plus" className="size-4" />ميزانية {currentYear}
            </Link>
          </Button>
        }
      />

      {years.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Icon name="Target" className="mx-auto mb-3 size-10 opacity-30" />
            <p>لا توجد ميزانيات بعد.</p>
            <Button asChild className="mt-4">
              <Link href={`/erp/accounting/budget/${currentYear}`}>إنشاء ميزانية {currentYear}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {years.map((y) => (
            <Card key={y.year} className="group transition-shadow hover:shadow-md">
              <CardContent className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-2xl font-bold tabular-nums">{y.year}</span>
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{y.count} حساب</span>
                </div>
                <p className="text-sm text-muted-foreground">إجمالي الميزانية</p>
                <p className="text-xl font-semibold tabular-nums">{fmt(Number(y.total))}</p>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" asChild>
                    <Link href={`/erp/accounting/budget/${y.year}`}><Icon name="Edit" className="size-3.5" />تعديل</Link>
                  </Button>
                  <Button size="sm" className="flex-1" asChild>
                    <Link href={`/erp/accounting/budget/${y.year}/report`}><Icon name="BarChart2" className="size-3.5" />التقرير</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
