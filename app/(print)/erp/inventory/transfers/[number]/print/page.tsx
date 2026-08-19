import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { stockTransfers, stockTransferLines, items, warehouses } from "@/db/schema";
import { qty, dt } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";
import { docNumberParam, docHref } from "@/lib/erp/doc-route";

type Params = { params: Promise<{ number: string }> };

export default async function PrintStockTransferPage({ params }: Params) {
  const raw = (await params).number;
  return loadErpPage("inventory.view", async ({ orgId }) => {
    const number = await docNumberParam(raw, orgId, stockTransfers,
      { id: stockTransfers.id, number: stockTransfers.number, organizationId: stockTransfers.organizationId }, "C:/Program Files/Git/erp/inventory/transfers", "C:/Program Files/Git/print");
    const [tr] = await db.select().from(stockTransfers)
      .where(and(eq(stockTransfers.number, number), eq(stockTransfers.organizationId, orgId))).limit(1);
    if (!tr) notFound();

    const fromWh = alias(warehouses, "from_wh");
    const toWh = alias(warehouses, "to_wh");
    const [{ org, hiddenFor, footerText }, lines] = await Promise.all([
      loadPrintHeader(orgId),
      db
        .select({
          itemCode: items.code,
          itemName: items.nameAr,
          from: fromWh.nameAr,
          to: toWh.nameAr,
          quantity: stockTransferLines.quantity,
        })
        .from(stockTransferLines)
        .leftJoin(items, eq(items.id, stockTransferLines.itemId))
        .leftJoin(fromWh, eq(fromWh.id, stockTransferLines.fromWarehouseId))
        .leftJoin(toWh, eq(toWh.id, stockTransferLines.toWarehouseId))
        .where(eq(stockTransferLines.stockTransferId, tr.id))
        .orderBy(asc(items.code)),
    ]);

    // Warehouses live on the lines (header from/to is legacy) — show the distinct set.
    const names = (vals: (string | null)[]) => {
      const u = [...new Set(vals.filter(Boolean) as string[])];
      return u.length ? u.join("، ") : "—";
    };

    return (
      <DocumentSheet
        org={org}
        hiddenColumns={hiddenFor("inventory-transfer")}
        footerText={footerText}
        title="تحويل مخزني"
        number={tr.number}
        backHref={`/inventory/transfers/${encodeURIComponent(tr.number)}`}
        watermark={tr.status === "DRAFT" ? "مسودة" : undefined}
        meta={[
          { label: "التاريخ", value: dt(tr.date) },
          { label: "الحالة", value: tr.status === "POSTED" ? "مرحّل" : "مسودة" },
          ...(tr.notes ? [{ label: "الملاحظات", value: tr.notes }] : []),
        ]}
        parties={[
          { label: "من مخزن", name: names(lines.map((l) => l.from)), lines: [] },
          { label: "إلى مخزن", name: names(lines.map((l) => l.to)), lines: [] },
        ]}
        columns={[
          { label: "الصنف", width: "75%" },
          { label: "الكمية", align: "center", width: "25%" },
        ]}
        rows={lines.map((l) => [
          <span key="n">
            <b>{l.itemName}</b>
            {l.itemCode && <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10.5, marginInlineStart: 6 }}>{l.itemCode}</span>}
          </span>,
          qty(l.quantity),
        ])}
        signatures={["المسلِّم", "المستلِم"]}
      />
    );
  });
}
