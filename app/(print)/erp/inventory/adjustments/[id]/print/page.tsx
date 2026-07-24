import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { stockAdjustments, stockAdjustmentLines, items, warehouses } from "@/db/schema";
import { fmt, qty, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

type Params = { params: Promise<{ id: string }> };

export default async function PrintStockAdjustmentPage({ params }: Params) {
  const { id } = await params;
  return loadErpPage("inventory.view", async ({ orgId }) => {
    const [adj] = await db.select().from(stockAdjustments)
      .where(and(eq(stockAdjustments.id, id), eq(stockAdjustments.organizationId, orgId))).limit(1);
    if (!adj) notFound();

    const [{ org, currency, hiddenFor, footerText }, lines] = await Promise.all([
      loadPrintHeader(orgId),
      db
        .select({
          itemCode: items.code,
          itemName: items.nameAr,
          warehouse: warehouses.nameAr,
          entered: stockAdjustmentLines.enteredValue,
          delta: stockAdjustmentLines.deltaQuantity,
          unitCost: stockAdjustmentLines.unitCost,
          totalValue: stockAdjustmentLines.totalValue,
        })
        .from(stockAdjustmentLines)
        .leftJoin(items, eq(items.id, stockAdjustmentLines.itemId))
        .leftJoin(warehouses, eq(warehouses.id, stockAdjustmentLines.warehouseId))
        .where(eq(stockAdjustmentLines.stockAdjustmentId, id))
        .orderBy(asc(items.code)),
    ]);

    return (
      <DocumentSheet
        org={org}
        hiddenColumns={hiddenFor("inventory-adjustment")}
        footerText={footerText}
        title="تسوية مخزون"
        number={adj.number}
        backHref={`/inventory/adjustments/${id}`}
        watermark={adj.status === "DRAFT" ? "مسودة" : undefined}
        meta={[
          { label: "التاريخ", value: dt(adj.date) },
          { label: "السبب", value: adj.reason },
          { label: "الحالة", value: adj.status === "POSTED" ? "مرحّل" : "مسودة" },
        ]}
        columns={[
          { label: "الصنف", width: "34%" },
          { label: "المخزن", width: "18%" },
          { label: "الكمية الفعلية", align: "center", width: "12%" },
          { label: "الفرق", align: "center", width: "12%" },
          { label: "التكلفة", align: "end", width: "12%" },
          { label: "القيمة", align: "end", width: "12%" },
        ]}
        rows={lines.map((l) => {
          const delta = Number(l.delta);
          return [
            <span key="n">
              <b>{l.itemName}</b>
              {l.itemCode && <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10.5, marginInlineStart: 6 }}>{l.itemCode}</span>}
            </span>,
            l.warehouse ?? "—",
            qty(l.entered),
            `${delta > 0 ? "+" : ""}${qty(delta)}`,
            l.unitCost != null ? fmt(l.unitCost) : "—",
            <b key="t">{fmt(l.totalValue)}</b>,
          ];
        })}
        totals={[{ label: "الإجمالي", value: money(adj.totalValue, currency), tone: "strong" as const }]}
        signatures={["أمين المخزن", "المراجع"]}
      />
    );
  });
}
