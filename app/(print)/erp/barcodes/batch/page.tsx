import { and, eq, inArray } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items, itemCodes } from "@/db/schema";
import { BarcodeLabelSheet, type LabelRow } from "@/components/erp/barcode-label-sheet";

/** Ad-hoc barcode labels for arbitrary items. ?items=<id>:<qty>,<id>:<qty>… */
export default async function BatchBarcodePage({ searchParams }: { searchParams: Promise<{ items?: string }> }) {
  return loadErpPage("inventory.view", async ({ orgId }) => {
    const raw = (await searchParams).items ?? "";

    const spec = raw.split(",").map((p) => p.split(":")).filter((p) => p[0])
      .map(([id, qty]) => ({ id, qty: Math.max(1, Math.min(500, Math.round(Number(qty) || 1))) }));
    const ids = [...new Set(spec.map((s) => s.id))];

    const labels: LabelRow[] = [];
    if (ids.length) {
      const rows = await db.select({ id: items.id, code: items.code, name: items.nameAr })
        .from(items).where(and(eq(items.organizationId, orgId), inArray(items.id, ids)));
      const byId = new Map(rows.map((r) => [r.id, r]));

      const codes = await db.select({ itemId: itemCodes.itemId, code: itemCodes.code })
        .from(itemCodes).where(and(inArray(itemCodes.itemId, ids), eq(itemCodes.isPrimary, true)));
      const barcodeById = new Map(codes.map((c) => [c.itemId, c.code]));

      for (const s of spec) {
        const it = byId.get(s.id);
        if (!it) continue;
        const barcode = barcodeById.get(s.id) || it.code || "";
        if (!barcode) continue;
        for (let i = 0; i < s.qty; i++) labels.push({ itemName: it.name ?? "", barcode, itemCode: it.code ?? "" });
      }
    }

    return <BarcodeLabelSheet labels={labels} title="ملصقات باركود" />;
  });
}
