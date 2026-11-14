import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { landedCostVouchers, landedCostVoucherLines, suppliers } from "@/db/schema";
import { loadErpPage } from "@/lib/erp/org";
import { getT } from "@/lib/i18n/server";
import { ErpPageHeader } from "@/components/erp/page-header";
import { LandedCostForm, type LandedCostInitial } from "@/components/erp/landed-cost-form";
import { getLandedCostReceiptsAction } from "@/app/actions/erp/landed-costs";
import { landedLineKey } from "@/lib/erp/landed-cost";

export default async function EditLandedCostPage({ params }: { params: Promise<{ number: string }> }) {
  const number = decodeURIComponent((await params).number);
  const t = await getT();
  return loadErpPage("purchases.create", async ({ orgId }) => {
    const [voucher] = await db.select().from(landedCostVouchers)
      .where(and(eq(landedCostVouchers.organizationId, orgId), eq(landedCostVouchers.number, number))).limit(1);
    if (!voucher) notFound();
    if (voucher.status !== "DRAFT") redirect(`/purchases/landed-costs/${encodeURIComponent(voucher.number)}`);
    const [lines, supList, receipts] = await Promise.all([
      db.select().from(landedCostVoucherLines).where(and(eq(landedCostVoucherLines.voucherId, voucher.id), eq(landedCostVoucherLines.organizationId, orgId))),
      db.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers).where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code)),
      getLandedCostReceiptsAction(),
    ]);
    const initial: LandedCostInitial = {
      id: voucher.id, number: voucher.number, supplierId: voucher.supplierId, date: voucher.date.toISOString().slice(0, 10), notes: voucher.notes ?? "", updatedAt: voucher.updatedAt.toISOString(),
      method: voucher.method as LandedCostInitial["method"], shipping: Number(voucher.shipping), customs: Number(voucher.customs), insurance: Number(voucher.insurance), other: Number(voucher.other),
      receiptIds: [...new Set(lines.map(l => l.purchaseReceiptId))],
      selection: lines.map(l => ({ key: landedLineKey(l), perUnit: Number(l.perUnit) })),
    };
    return <div className="space-y-6">
      <ErpPageHeader icon="Ship" title={t("تعديل تكاليف الاستيراد")} backHref={`/purchases/landed-costs/${encodeURIComponent(number)}`} />
      <LandedCostForm suppliers={supList} receipts={receipts.ok ? receipts.receipts ?? [] : []} initial={initial} />
    </div>;
  });
}
