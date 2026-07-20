import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import {
  purchaseReceipts, purchaseReceiptLines,
  deliveryNotes, deliveryNoteLines,
  stockTransfers, stockTransferLines,
  items, itemCodes,
} from "@/db/schema";
import { BarcodeLabelSheet } from "@/components/erp/barcode-label-sheet";

type Params = { params: Promise<{ type: string; id: string }> };

type LabelItem = {
  itemCode: string;
  itemName: string;
  barcode: string;
  quantity: number;
};

async function fetchItems(type: string, id: string, orgId: string): Promise<LabelItem[] | null> {
  if (type === "receipt") {
    const [doc] = await db.select().from(purchaseReceipts)
      .where(and(eq(purchaseReceipts.id, id), eq(purchaseReceipts.organizationId, orgId))).limit(1);
    if (!doc) return null;

    const lines = await db
      .select({ qty: purchaseReceiptLines.quantity, itemId: purchaseReceiptLines.itemId, code: items.code, name: items.nameAr })
      .from(purchaseReceiptLines)
      .leftJoin(items, eq(items.id, purchaseReceiptLines.itemId))
      .where(eq(purchaseReceiptLines.purchaseReceiptId, id));

    return buildLabels(lines);
  }

  if (type === "delivery") {
    const [doc] = await db.select().from(deliveryNotes)
      .where(and(eq(deliveryNotes.id, id), eq(deliveryNotes.organizationId, orgId))).limit(1);
    if (!doc) return null;

    const lines = await db
      .select({ qty: deliveryNoteLines.quantity, itemId: deliveryNoteLines.itemId, code: items.code, name: items.nameAr })
      .from(deliveryNoteLines)
      .leftJoin(items, eq(items.id, deliveryNoteLines.itemId))
      .where(eq(deliveryNoteLines.deliveryNoteId, id));

    return buildLabels(lines);
  }

  if (type === "transfer") {
    const [doc] = await db.select().from(stockTransfers)
      .where(and(eq(stockTransfers.id, id), eq(stockTransfers.organizationId, orgId))).limit(1);
    if (!doc) return null;

    const lines = await db
      .select({ qty: stockTransferLines.quantity, itemId: stockTransferLines.itemId, code: items.code, name: items.nameAr })
      .from(stockTransferLines)
      .leftJoin(items, eq(items.id, stockTransferLines.itemId))
      .where(eq(stockTransferLines.stockTransferId, id));

    return buildLabels(lines);
  }

  return null;
}

async function buildLabels(
  lines: { qty: string | null; itemId: string | null; code: string | null; name: string | null }[],
): Promise<LabelItem[]> {
  // Fetch primary barcode for each item
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter(Boolean))] as string[];
  const barcodeMap: Record<string, string> = {};

  if (itemIds.length > 0) {
    // Get primary barcode per item (or first barcode if no primary)
    const primaryCodes = await db
      .select({ itemId: itemCodes.itemId, code: itemCodes.code })
      .from(itemCodes)
      .where(eq(itemCodes.isPrimary, true));

    for (const r of primaryCodes) {
      if (r.itemId && itemIds.includes(r.itemId)) {
        barcodeMap[r.itemId] = r.code;
      }
    }

    // Fallback: items without primary barcode → use item code
  }

  return lines.map((l) => {
    const barcode = (l.itemId && barcodeMap[l.itemId]) || l.code || "";
    return {
      itemCode: l.code ?? "",
      itemName: l.name ?? "",
      barcode,
      quantity: Math.max(1, Math.round(Number(l.qty ?? 1))),
    };
  }).filter((l) => l.barcode);
}

const TYPE_LABELS: Record<string, string> = {
  receipt: "إذن استلام",
  delivery: "إذن صرف",
  transfer: "تحويل مخزني",
};

export default async function BarcodePrintPage({ params }: Params) {
  const { type, id } = await params;
  if (!["receipt", "delivery", "transfer"].includes(type)) notFound();

  return loadErpPage("inventory.view", async ({ orgId }) => {
    const labelItems = await fetchItems(type, id, orgId);
    if (!labelItems) notFound();

    // Expand: qty=3 → 3 identical label entries
    const labels: Omit<LabelItem, "quantity">[] = [];
    for (const item of labelItems) {
      for (let i = 0; i < item.quantity; i++) {
        labels.push({ itemCode: item.itemCode, itemName: item.itemName, barcode: item.barcode });
      }
    }

    const docType = TYPE_LABELS[type] ?? type;
    return <BarcodeLabelSheet labels={labels} title={docType} />;
  });
}
