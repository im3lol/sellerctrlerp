import { and, asc, desc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { suppliers, warehouses, items, organizations, materialRequests, materialRequestLines, currencies, exchangeRates } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PurchaseOrderForm } from "@/components/erp/purchase-order-form";
import { getUnitsByItem } from "@/lib/erp/item-units-data";
import { getReorderPlan } from "@/lib/erp/reorder-data";

type SP = { reorder?: string; fromRequisition?: string; window?: string; lead?: string; cover?: string; supplier?: string };
const days = (v: string | undefined, def: number) => (Number(v) > 0 && Number(v) <= 365 ? Number(v) : def);

export default async function NewPurchaseOrderPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("purchases.view", async ({ orgId }) => {
    const sp = await searchParams;
    const reorder = sp.reorder === "1";
    const fromRequisition = sp.fromRequisition;

    const [supList, whList, itemList, org, currRows, rateRows] = await Promise.all([
      db.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers)
        .where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code)),
      db.select({ id: warehouses.id, nameAr: warehouses.nameAr }).from(warehouses)
        .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)),
      db.select({ id: items.id, nameAr: items.nameAr, code: items.code, image: items.image, weightKg: items.weightKg }).from(items)
        .where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code)),
      db.select({ nameAr: organizations.nameAr, vatRate: organizations.vatRate }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
      db.select({ code: currencies.code, nameAr: currencies.nameAr, isBase: currencies.isBase, exchangeRate: currencies.exchangeRate }).from(currencies)
        .where(and(eq(currencies.organizationId, orgId), eq(currencies.isActive, true))).orderBy(currencies.isBase, currencies.code),
      // Dated history, not just the newest: an order dated last month must default to
      // last month's rate, and the person raising it should be able to see and pick from
      // what was actually recorded.
      db.select({ currencyCode: exchangeRates.currencyCode, date: exchangeRates.date, rate: exchangeRates.rate }).from(exchangeRates)
        .where(eq(exchangeRates.organizationId, orgId)).orderBy(desc(exchangeRates.date)).limit(200),
    ]);
    const unitsByItem = await getUnitsByItem(orgId);

    // Latest rate per currency: historical exchange_rates row wins over the snapshot.
    const latestRates: Record<string, number> = {};
    for (const r of rateRows) if (!(r.currencyCode in latestRates)) latestRates[r.currencyCode] = Number(r.rate);
    for (const c of currRows) if (!(c.code in latestRates)) latestRates[c.code] = Number(c.exchangeRate) || 1;

    const rateHistory: Record<string, { date: string; rate: number }[]> = {};
    for (const r of rateRows) {
      (rateHistory[r.currencyCode] ??= []).push({ date: new Date(r.date).toISOString().slice(0, 10), rate: Number(r.rate) });
    }

    // Last unit price paid per item (any supplier) — suggested on the PO line.
    // ponytail: last price across all suppliers; make it per-supplier if negotiated price lists are needed.
    const lastPriceRows = (await db.execute<{ item_id: string; unit_price: string }>(sql`
      SELECT DISTINCT ON (pol.item_id) pol.item_id, pol.unit_price
      FROM purchase_order_lines pol
      JOIN purchase_orders po ON po.id = pol.purchase_order_id
      WHERE po.organization_id = ${orgId} AND pol.unit_price > 0
      ORDER BY pol.item_id, po.date DESC, po.created_at DESC
    `)).rows as { item_id: string; unit_price: string }[];
    const lastPrices: Record<string, number> = {};
    for (const r of lastPriceRows) lastPrices[r.item_id] = Number(r.unit_price);

    let initialLines: { itemId: string; quantity: number }[] | undefined;
    let requisitionId: string | undefined;

    // Prefill from an APPROVED requisition that hasn't been ordered yet — a draft isn't
    // an authorisation, and an already-converted one would raise a second order.
    if (fromRequisition) {
      const [mr] = await db.select({ id: materialRequests.id, status: materialRequests.status }).from(materialRequests)
        .where(and(eq(materialRequests.id, fromRequisition), eq(materialRequests.organizationId, orgId))).limit(1);
      if (mr?.status === "APPROVED") {
        const mrl = await db.select({ itemId: materialRequestLines.itemId, quantity: materialRequestLines.quantity })
          .from(materialRequestLines).where(eq(materialRequestLines.materialRequestId, mr.id));
        if (mrl.length) {
          initialLines = mrl.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) }));
          requisitionId = mr.id;
        }
      }
    }

    // Prefill from the reorder plan — the same quantities the reorder page showed, for the
    // items last bought from `supplier` ("none" = never bought before; absent = all).
    let initialSupplierId: string | undefined;
    if (reorder && !initialLines) {
      const plan = await getReorderPlan(orgId, { windowDays: days(sp.window, 30), leadDays: days(sp.lead, 14), coverDays: days(sp.cover, 60) });
      const want = sp.supplier === "none" ? null : sp.supplier;
      const mine = plan.filter((r) => r.suggestedQty > 0 && (sp.supplier === undefined || r.supplierId === want));
      if (mine.length) initialLines = mine.map((r) => ({ itemId: r.itemId, quantity: r.suggestedQty }));
      if (want && supList.some((s) => s.id === want)) initialSupplierId = want;
    }

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="ClipboardList" title="أمر شراء جديد" subtitle={initialLines ? "معبّأ مسبقاً — اختر المورّد وراجِع الكميات" : "التزام شراء — يُحوّل لفاتورة لاحقاً"} backHref="/purchases/orders" />
        <PurchaseOrderForm suppliers={supList} warehouses={whList} items={itemList} unitsByItem={unitsByItem} orgName={org[0]?.nameAr ?? "—"} vatRate={Number(org[0]?.vatRate ?? 0)} initialLines={initialLines} initialSupplierId={initialSupplierId} requisitionId={requisitionId} lastPrices={lastPrices} currencies={currRows} latestRates={latestRates}
        rateHistory={rateHistory} />
      </div>
    );
  });
}
