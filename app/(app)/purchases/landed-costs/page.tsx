import Link from "next/link";
import { fill } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { count, desc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { landedCostVouchers, suppliers } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";

const PER_PAGE = 20;
const fmt = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  POSTED: { label: "مُرحّل", variant: "default" },
  CANCELLED: { label: "ملغي", variant: "destructive" },
};

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function LandedCostsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const t = await getT();
  return loadErpPage("purchases.create", async ({ orgId, can }) => {
    const canManage = can("purchases.create");
    const page = Math.max(1, parseInt(one((await searchParams).page) || "1", 10) || 1);
    const where = eq(landedCostVouchers.organizationId, orgId);

    const [[{ total }], rows] = await Promise.all([
      db.select({ total: count() }).from(landedCostVouchers).where(where),
      db.select({
        id: landedCostVouchers.id, number: landedCostVouchers.number, date: landedCostVouchers.date,
        status: landedCostVouchers.status, totalAmount: landedCostVouchers.totalAmount,
        method: landedCostVouchers.method, supplier: suppliers.nameAr,
      })
        .from(landedCostVouchers)
        .leftJoin(suppliers, eq(suppliers.id, landedCostVouchers.supplierId))
        .where(where)
        .orderBy(desc(landedCostVouchers.date), desc(landedCostVouchers.number))
        .limit(PER_PAGE)
        .offset((page - 1) * PER_PAGE),
    ]);
    const pages = Math.max(1, Math.ceil(Number(total) / PER_PAGE));

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Ship"
          title={t("تكاليف الاستيراد")}
          subtitle={fill(t("{0} مستند"), [total])}
          action={canManage ? (
            <Button asChild><Link href="/purchases/landed-costs/new"><Icon name="Plus" className="size-4" />{t("مستند تكاليف")}</Link></Button>
          ) : undefined}
        />

        <Card>
          <CardHeader>
            <CardTitle>{t("مستندات تكاليف الاستيراد")}</CardTitle>
            <CardDescription>
              {t("فاتورة الشحن/الجمارك التي تصل بعد استلام البضاعة. الترحيل يرفع تكلفة المخزون المتاح، وما بِيع منه بالفعل يذهب إلى تكلفة المبيعات، والمقابل مستحق للمورّد.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
                {t("لا توجد مستندات بعد — أنشئ واحداً بعد استلام البضاعة ووصول فاتورة الشحن.")}
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">{t("الرقم")}</TableHead>
                      <TableHead className="text-start">{t("التاريخ")}</TableHead>
                      <TableHead className="text-start">{t("المورّد")}</TableHead>
                      <TableHead className="text-start">{t("طريقة التوزيع")}</TableHead>
                      <TableHead className="text-start">{t("الإجمالي")}</TableHead>
                      <TableHead className="text-start">{t("الحالة")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const st = STATUS[r.status] ?? { label: r.status, variant: "secondary" as const };
                      return (
                        <TableRow key={r.id}>
                          <TableCell>
                            <Link href={`/purchases/landed-costs/${encodeURIComponent(r.number)}`} className="font-mono text-sm text-primary hover:underline">{r.number}</Link>
                          </TableCell>
                          <TableCell>{dt(r.date)}</TableCell>
                          <TableCell>{r.supplier ?? "—"}</TableCell>
                          <TableCell>{r.method === "weight" ? t("بالوزن") : r.method === "qty" ? t("بالكمية") : t("بالقيمة")}</TableCell>
                          <TableCell className="tabular-nums">{fmt(r.totalAmount)}</TableCell>
                          <TableCell><Badge variant={st.variant}>{t(st.label)}</Badge></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {pages > 1 && (
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{t("صفحة")} {page} {t("من")} {pages}</span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>
                        {page > 1 ? <a href={`?page=${page - 1}`}>{t("السابق")}</a> : <span>{t("السابق")}</span>}
                      </Button>
                      <Button variant="outline" size="sm" disabled={page >= pages} asChild={page < pages}>
                        {page < pages ? <a href={`?page=${page + 1}`}>{t("التالي")}</a> : <span>{t("التالي")}</span>}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
