import { planReorder, type ReorderPlan, type ReorderStatus } from "@/lib/erp/reorder";

/**
 * What to send to Amazon FBA. Pure: the same arithmetic as reordering from a supplier
 * (planReorder), with Amazon's shelf as the stock and my own warehouse as the supplier —
 * the shipment has to cover the days it spends in transit plus the target cover, less
 * what Amazon already holds or has on the way, and can never exceed what I have.
 */

export type FbaPlanInput = {
  itemId: string; code: string; name: string;
  /** Seller SKU (MSKU) and ASIN from the latest FBA audit, when there is one. */
  sku: string | null; asin: string | null;
  /** Sellable at Amazon now, and units already on the way there. */
  fbaAvailable: number; fbaInbound: number;
  /** Units that left Amazon's warehouse (sold) within the window. */
  soldAtAmazon: number;
  /** On hand in the warehouse the shipment leaves from. */
  sourceOnHand: number;
};

export type FbaPlanParams = { windowDays: number; transitDays: number; coverDays: number };

export type FbaPlanRow = FbaPlanInput & ReorderPlan & {
  /** Units to send: what Amazon needs, capped by what the source warehouse holds. */
  sendQty: number;
  /** Needed at Amazon but not in the source warehouse — buy it, or send from elsewhere. */
  short: number;
};

const RANK: Record<ReorderStatus, number> = { out: 0, critical: 1, low: 2, ok: 3 };

export function planFbaShipment(inputs: FbaPlanInput[], p: FbaPlanParams): FbaPlanRow[] {
  return inputs
    .map((r) => {
      const plan = planReorder({
        onHand: r.fbaAvailable, inbound: r.fbaInbound, soldInWindow: r.soldAtAmazon,
        windowDays: p.windowDays, leadDays: p.transitDays, coverDays: p.transitDays + p.coverDays, minStock: 0,
      });
      const sendQty = Math.max(0, Math.min(plan.suggestedQty, Math.floor(r.sourceOnHand)));
      return { ...r, ...plan, sendQty, short: plan.suggestedQty - sendQty };
    })
    // Nothing to send when Amazon is covered — or when nothing sells there to plan from.
    .filter((r) => r.suggestedQty > 0)
    .sort((a, b) => RANK[a.status] - RANK[b.status] || a.daysOfCover - b.daysOfCover);
}
