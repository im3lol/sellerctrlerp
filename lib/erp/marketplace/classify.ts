import type { MarketplaceOrder, MarketplaceProduct } from "./dto";

// Pure order-routing logic (no DB/action imports) so it stays unit-testable.
// Given a resolver (code→item) and the set of already-imported orders, sort each
// incoming order into: create / transition / duplicate / blocked, plus the list
// of unmatched codes.

export type MatchedLine = MarketplaceOrder["lines"][number] & { itemId: string | null; itemName: string | null };
export type PreviewOrder = {
  externalId: string; date: string; status: string; fulfillment?: string; currency?: string;
  subtotal: number; shippingTotal: number; discount?: number; total: number;
  lines: MatchedLine[];
  existingId?: string; existingStatus?: string;
};
export type OrdersPreview = {
  totalOrders: number;
  toCreate: PreviewOrder[];
  transitions: PreviewOrder[];
  toCancel: PreviewOrder[];
  duplicates: PreviewOrder[];
  blocked: PreviewOrder[];
  unmatched: { code: string; altCode?: string; name?: string; sampleOrder: string }[];
};

export type ItemResolver = (code: string, altCode?: string) => { itemId: string | null; itemName: string | null };

export function classifyOrders(
  orders: MarketplaceOrder[],
  resolve: ItemResolver,
  existing: Map<string, { id: string; status: string }>,
): OrdersPreview {
  const toCreate: PreviewOrder[] = [];
  const transitions: PreviewOrder[] = [];
  const toCancel: PreviewOrder[] = [];
  const duplicates: PreviewOrder[] = [];
  const blocked: PreviewOrder[] = [];
  const unmatchedMap = new Map<string, { code: string; altCode?: string; name?: string; sampleOrder: string }>();

  for (const o of orders) {
    const lines: MatchedLine[] = o.lines.map((l) => {
      const m = resolve(l.code, l.altCode);
      return { ...l, itemId: m.itemId, itemName: m.itemName };
    });
    const po: PreviewOrder = { externalId: o.externalId, date: o.date, status: o.status, fulfillment: o.fulfillment, currency: o.currency, subtotal: o.subtotal, shippingTotal: o.shippingTotal, discount: o.discount, total: o.total, lines };
    const fullyMatched = lines.every((l) => l.itemId);
    const ex = existing.get(o.externalId);

    // Cancelled at the marketplace: tear down a previously-imported order that
    // isn't already cancelled. A cancellation for an unknown order is a no-op.
    if (o.status === "Canceled") {
      if (ex && ex.status !== "CANCELLED") toCancel.push({ ...po, existingId: ex.id, existingStatus: ex.status });
      else duplicates.push(po);
      continue;
    }

    if (ex) {
      // A DRAFT order is still editable: refresh it every pull (price backfill +
      // channel-status update, and advance it when Amazon marks it Shipped). Once
      // it's confirmed/delivered/invoiced it's frozen — a re-pull is a duplicate.
      if (ex.status === "DRAFT") transitions.push({ ...po, existingId: ex.id, existingStatus: ex.status });
      else duplicates.push(po);
      continue;
    }
    if (!fullyMatched) {
      blocked.push(po);
      for (const l of lines) if (!l.itemId && l.code && !unmatchedMap.has(l.code)) {
        unmatchedMap.set(l.code, { code: l.code, altCode: l.altCode, name: l.name, sampleOrder: o.externalId });
      }
      continue;
    }
    toCreate.push(po);
  }
  return { totalOrders: orders.length, toCreate, transitions, toCancel, duplicates, blocked, unmatched: [...unmatchedMap.values()] };
}

// ── Product routing (pure) ──
// Same upper+alnum normalization as lib/erp/amazon-import.normalizeCode, inlined
// to keep this module DB-free (unit-testable).
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export type ProductPlan = {
  toLink: { itemId: string; sku: string }[]; // matched item — attach its SKU code
  toCreate: MarketplaceProduct[];
  alreadyLinked: number;
  skippedUnmatched: number;
};

/**
 * Decide link/create/skip per listing. Linking REQUIRES the listing's ASIN to be
 * in `itemByAsin` (normalized ASIN item_code → itemId). `known` = every existing
 * normalized code, to tell an already-attached SKU from a new one. `link` skips
 * unmatched (needs ASIN); `create` queues them for a new item.
 */
export function classifyProducts(
  products: MarketplaceProduct[],
  itemByAsin: Map<string, string>,
  known: Set<string>,
  mode: "create" | "link",
): ProductPlan {
  const plan: ProductPlan = { toLink: [], toCreate: [], alreadyLinked: 0, skippedUnmatched: 0 };
  for (const p of products) {
    const nSku = norm(p.code), nAsin = norm(p.altCode || "");
    const matchId = nAsin ? itemByAsin.get(nAsin) : undefined;
    if (matchId) {
      if (nSku && !known.has(nSku)) plan.toLink.push({ itemId: matchId, sku: p.code });
      else plan.alreadyLinked++;
    } else if (mode === "create") {
      plan.toCreate.push(p);
    } else {
      plan.skippedUnmatched++;
    }
  }
  return plan;
}
