import type { MarketplaceOrder } from "./dto";

// Pure order-routing logic (no DB/action imports) so it stays unit-testable.
// Given a resolver (code→item) and the set of already-imported orders, sort each
// incoming order into: create / transition / duplicate / blocked, plus the list
// of unmatched codes.

export type MatchedLine = MarketplaceOrder["lines"][number] & { itemId: string | null; itemName: string | null };
export type PreviewOrder = {
  externalId: string; date: string; status: string;
  subtotal: number; shippingTotal: number; total: number;
  lines: MatchedLine[];
  existingId?: string; existingStatus?: string;
};
export type OrdersPreview = {
  totalOrders: number;
  toCreate: PreviewOrder[];
  transitions: PreviewOrder[];
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
  const duplicates: PreviewOrder[] = [];
  const blocked: PreviewOrder[] = [];
  const unmatchedMap = new Map<string, { code: string; altCode?: string; name?: string; sampleOrder: string }>();

  for (const o of orders) {
    const lines: MatchedLine[] = o.lines.map((l) => {
      const m = resolve(l.code, l.altCode);
      return { ...l, itemId: m.itemId, itemName: m.itemName };
    });
    const po: PreviewOrder = { externalId: o.externalId, date: o.date, status: o.status, subtotal: o.subtotal, shippingTotal: o.shippingTotal, total: o.total, lines };
    const fullyMatched = lines.every((l) => l.itemId);
    const ex = existing.get(o.externalId);
    if (ex) {
      const doneStatus = ex.status === "CANCELLED" || ex.status === "DELIVERED" || ex.status === "INVOICED";
      if (o.status === "Shipped" && fullyMatched && !doneStatus) transitions.push({ ...po, existingId: ex.id, existingStatus: ex.status });
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
  return { totalOrders: orders.length, toCreate, transitions, duplicates, blocked, unmatched: [...unmatchedMap.values()] };
}
