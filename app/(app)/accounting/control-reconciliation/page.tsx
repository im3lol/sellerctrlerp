import { eq, sql } from "drizzle-orm";
import { fill } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { customers, suppliers } from "@/db/schema";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Reconcile the customer/supplier subledgers against their GL control accounts.
 *  Σ customers.balance must equal GL 1103 (receivables); Σ suppliers.balance must
 *  equal GL 2101 (payables). A non-zero difference means a posting/subledger drift.
 *  Read-only. */
export default async function ControlReconciliationPage() {
  const t = await getT();
  return loadErpPage("reports.view", async ({ orgId }) => {
    const [[ar], [ap], codeMap, balances] = await Promise.all([
      db.select({ v: sql<string>`coalesce(sum(${customers.balance}), 0)` }).from(customers).where(eq(customers.organizationId, orgId)),
      db.select({ v: sql<string>`coalesce(sum(${suppliers.balance}), 0)` }).from(suppliers).where(eq(suppliers.organizationId, orgId)),
      resolveAccountIds(orgId, ["1103", "2101"]),
      accountBalances({ orgId }),
    ]);

    const glValue = (code: string) => {
      const id = codeMap[code];
      const acc = id ? balances.find((b) => b.id === id) : undefined;
      return acc ? { value: naturalAmount(acc), label: `${acc.code} — ${t(acc.nameAr)}` } : { value: 0, label: fill(t("{0} (غير مضبوط)"), [code]) };
    };

    const rows = [
      { name: "ذمم العملاء (مدينة)", sub: Number(ar?.v ?? 0), gl: glValue("1103") },
      { name: "ذمم الموردين (دائنة)", sub: Number(ap?.v ?? 0), gl: glValue("2101") },
    ].map((r) => ({ ...r, diff: r.gl.value - r.sub, matched: Math.abs(r.gl.value - r.sub) < 0.01 }));

    const allMatched = rows.every((r) => r.matched);

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Scale" title={t("مطابقة حسابات المراقبة")} subtitle={t("أرصدة العملاء والموردين مقابل حسابات المراقبة في الأستاذ العام")} backHref="/accounting" />

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>{t("المطابقة")}</CardTitle>
              <CardDescription>{t("مجموع أرصدة دفتر المساعد يجب أن يطابق رصيد حساب المراقبة؛ أي فرق يشير إلى انحراف في الترحيل.")}</CardDescription>
            </div>
            <Badge variant={allMatched ? "default" : "destructive"} className="text-sm">{allMatched ? t("مطابَق") : t("غير مطابَق")}</Badge>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-start">{t("البند")}</TableHead>
                <TableHead className="text-start">{t("حساب المراقبة")}</TableHead>
                <TableHead className="text-end">{t("دفتر المساعد")}</TableHead>
                <TableHead className="text-end">{t("الأستاذ العام")}</TableHead>
                <TableHead className="text-end">{t("الفرق")}</TableHead>
                <TableHead className="text-start">{t("الحالة")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell>{t(r.name)}</TableCell>
                    <TableCell className="text-muted-foreground">{t(r.gl.label)}</TableCell>
                    <TableCell className="text-end tabular-nums">{fmt(r.sub)}</TableCell>
                    <TableCell className="text-end tabular-nums">{fmt(r.gl.value)}</TableCell>
                    <TableCell className={`text-end tabular-nums ${r.matched ? "" : "text-destructive font-medium"}`}>{fmt(r.diff)}</TableCell>
                    <TableCell><Badge variant={r.matched ? "default" : "destructive"}>{r.matched ? t("مطابَق") : t("فرق")}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  });
}
