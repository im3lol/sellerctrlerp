import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import {
  purchaseReceipts, purchaseReceiptLines,
  deliveryNotes, deliveryNoteLines,
  stockTransfers, stockTransferLines,
  items, itemCodes,
} from "@/db/schema";
import { code128Svg } from "@/lib/code128";

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

  const { orgId } = await requireErpModule("inventory.view");
  const labelItems = await fetchItems(type, id, orgId);
  if (!labelItems) notFound();

  // Expand: qty=3 → 3 identical label entries
  const labels: Omit<LabelItem, "quantity">[] = [];
  for (const item of labelItems) {
    for (let i = 0; i < item.quantity; i++) {
      labels.push({ itemCode: item.itemCode, itemName: item.itemName, barcode: item.barcode });
    }
  }

  const totalLabels = labels.length;
  const docType = TYPE_LABELS[type] ?? type;

  return (
    <>
      <style>{`
        /* ── label page size ── */
        @page {
          size: 50mm 25mm;
          margin: 0;
        }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: white; }

        /* each label fills exactly one 50×25 mm page */
        .label {
          width: 50mm;
          height: 25mm;
          padding: 1mm 1.5mm;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          overflow: hidden;
          page-break-after: always;
          background: white;
        }
        .label:last-child { page-break-after: avoid; }

        .item-name {
          font-family: 'Segoe UI', 'Noto Sans Arabic', sans-serif;
          font-size: 6pt;
          line-height: 1.2;
          max-height: 6mm;
          overflow: hidden;
          text-align: right;
          direction: rtl;
          color: #000;
          word-break: break-word;
        }
        .barcode-wrap {
          flex: 1;
          display: flex;
          align-items: center;
          padding: 0.5mm 0;
        }
        .barcode-wrap svg {
          width: 100%;
          height: 11mm;
          display: block;
        }
        .item-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-family: monospace;
          font-size: 5pt;
          color: #444;
          direction: ltr;
        }

        /* ── no-print toolbar ── */
        .toolbar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 16px;
          background: #f8f9fa;
          border-bottom: 1px solid #dee2e6;
          font-family: 'Segoe UI', sans-serif;
          font-size: 13px;
        }
        .toolbar button {
          padding: 6px 16px;
          border: none;
          border-radius: 4px;
          background: #0d6efd;
          color: white;
          font-size: 13px;
          cursor: pointer;
          font-family: inherit;
        }
        .toolbar button:hover { background: #0b5ed7; }
        .toolbar .back {
          background: transparent;
          border: 1px solid #ccc;
          color: #333;
        }
        .toolbar .back:hover { background: #e9ecef; }
        .toolbar .info { color: #555; margin-right: auto; }
        @media print { .toolbar { display: none !important; } }

        /* preview gap between labels */
        @media screen {
          body { padding-top: 52px; background: #e9ecef; }
          .label {
            margin: 8px auto;
            border: 1px solid #ccc;
            box-shadow: 0 1px 4px rgba(0,0,0,.15);
          }
        }
      `}</style>

      <div className="toolbar">
        <button onClick={() => window.print()}>🖨 طباعة / حفظ PDF</button>
        <button className="back" onClick={() => window.history.back()}>رجوع</button>
        <span className="info">{docType} — {totalLabels} ملصق</span>
      </div>

      {labels.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px", fontFamily: "sans-serif", color: "#888" }}>
          لا توجد بنود بباركود في هذه الوثيقة.
        </div>
      ) : (
        labels.map((label, i) => {
          const svgMarkup = code128Svg(label.barcode, 32, false);
          return (
            <div key={i} className="label">
              <div className="item-name">{label.itemName}</div>
              <div className="barcode-wrap" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
              <div className="item-footer">
                <span>{label.barcode}</span>
                <span>{label.itemCode}</span>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
