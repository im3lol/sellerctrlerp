import { notFound, redirect } from "next/navigation";
import { fill } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { landedCostVouchers, landedCostVoucherLines, suppliers, items, warehouses, purchaseReceipts } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PaginatedTableRows } from "@/components/erp/paginated-table-rows";
import { LandedCostDetailActions } from "@/components/erp/landed-cost-detail-actions";
import { Field, LinkedDocsCard, UUID_RE, type DocLink } from "@/components/erp/document-detail";
import { DocChatter } from "@/components/erp/doc-chatter";
import { getDocumentAudit } from "@/lib/erp/audit";

const fmt = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  POSTED: { label: "مُرحّل", variant: "default" },
  CANCELLED: { label: "ملغي", variant: "destructive" },
};
const METHOD: Record<string, string> = { value: "حسب القيمة", qty: "حسب الكمية", weight: "حسب الوزن" };

export default async function LandedCostDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const t = await getT();
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("purchases.create", async ({ orgId, can }) => {
    if (UUID_RE.test(raw)) {
      const [byId] = await db.select({ number: landedCostVouchers.number }).from(landedCostVouchers)
        .where(and(eq(landedCostVouchers.id, raw), eq(landedCostVouchers.organizationId, orgId))).limit(1);
      if (!byId) notFound();
      redirect(`/purchases/landed-costs/${encodeURIComponent(byId.number)}`);
    }

    const [v] = await db.select().from(landedCostVouchers)
      .where(and(eq(landedCostVouchers.number, raw), eq(landedCostVouchers.organizationId, orgId))).limit(1);
    if (!v) notFound();

    const [[sup], lines, audit] = await Promise.all([
      db.select({ code: suppliers.code, name: suppliers.nameAr }).from(suppliers).where(eq(suppliers.id, v.supplierId)).limit(1),
      db.select({
        id: landedCostVoucherLines.id, quantity: landedCostVoucherLines.quantity,
        allocated: landedCostVoucherLines.allocatedAmount, perUnit: landedCostVoucherLines.perUnit,
        code: items.code, name: items.nameAr, wh: warehouses.nameAr, receipt: purchaseReceipts.number,
      })
        .from(landedCostVoucherLines)
        .leftJoin(items, eq(items.id, landedCostVoucherLines.itemId))
        .leftJoin(warehouses, eq(warehouses.id, landedCostVoucherLines.warehouseId))
        .leftJoin(purchaseReceipts, eq(purchaseReceipts.id, landedCostVoucherLines.purchaseReceiptId))
        .where(eq(landedCostVoucherLines.voucherId, v.id)),
      getDocumentAudit(orgId, v.id),
    ]);

    const linked: DocLink[] = [...new Set(lines.map((l) => l.receipt).filter((x): x is string => !!x))]
      .map((n) => ({ label: "إذن استلام", number: n, href: `/purchases/receipts/${encodeURIComponent(n)}` }));

    const st = STATUS[v.status] ?? { label: v.status, variant: "secondary" as const };

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Ship"
          title={fill(t("تكاليف استيراد {0}"), [v.number])}
          subtitle={sup ? `${sup.code} — ${sup.name}` : "مستند تكاليف"}
          backHref="/purchases/landed-costs"
          action={<LandedCostDetailActions id={v.id} status={v.status} canManage={can("purchases.create")} canPost={can("purchases.confirm")} />}
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("الحالة")}><Badge variant={st.variant}>{t(st.label)}</Badge></Field>
          <Field label={t("التاريخ")}>{dt(v.date)}</Field>
          <Field label={t("طريقة التوزيع")}>{t(METHOD[v.method] ?? v.method)}</Field>
          <Field label={t("الإجمالي")}>{fmt(v.totalAmount)} {t("ج.م")}</Field>
          <Field label={t("الشحن")}>{fmt(v.shipping)}</Field>
          <Field label={t("الجمارك")}>{fmt(v.customs)}</Field>
          <Field label={t("التأمين")}>{fmt(v.insurance)}</Field>
          <Field label={t("أخرى")}>{fmt(v.other)}</Field>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("توزيع التكاليف")}</CardTitle>
            <CardDescription>{t("ما حُمِّل على كل بند من إذون الاستلام المشمولة.")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">{t("الإذن")}</TableHead>
                  <TableHead className="text-start">{t("الصنف")}</TableHead>
                  <TableHead className="text-start">{t("المستودع")}</TableHead>
                  <TableHead className="text-start">{t("الكمية")}</TableHead>
                  <TableHead className="text-start">{t("شحن/وحدة")}</TableHead>
                  <TableHead className="text-start">{t("المحمَّل")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <PaginatedTableRows rows={lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{l.receipt ?? "—"}</TableCell>
                    <TableCell className="max-w-[320px] whitespace-normal">
                      <div className="line-clamp-2 leading-snug" title={l.name ?? undefined}>{t(l.name ?? "")}</div>
                      <div className="font-mono text-xs text-muted-foreground" dir="ltr">{l.code}</div>
                    </TableCell>
                    <TableCell>{l.wh ?? "—"}</TableCell>
                    <TableCell>{qtyf(l.quantity)}</TableCell>
                    <TableCell className="tabular-nums">{fmt(l.perUnit)}</TableCell>
                    <TableCell className="font-medium tabular-nums">{fmt(l.allocated)}</TableCell>
                  </TableRow>
                ))} />
              </TableBody>
            </Table>
            {v.notes && <p className="mt-4 text-sm text-muted-foreground">{t("ملاحظات:")} {v.notes}</p>}
          </CardContent>
        </Card>

        <LinkedDocsCard links={linked} />
        <DocChatter kind="LANDED_COST" entityId={v.id} entityNumber={v.number} audit={audit} />
      </div>
    );
  });
}
