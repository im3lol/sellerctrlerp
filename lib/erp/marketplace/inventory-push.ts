import type { MarketplaceInventoryUpdate } from "./dto";

/**
 * P2.1 foundation (no external writes yet). Diff the ERP's available-to-sell against a
 * channel's current on-hand → the minimal set of SKUs whose quantity needs pushing back,
 * so the same seller SKU listed on several channels can't oversell.
 *
 * Rules (match the confirmed design — ERP is the source of truth, push available = on-hand −
 * reserved):
 *  - Only SKUs the channel ALREADY lists are touched (a SKU absent from `channelOnHand` is
 *    not listed there → an inventory push would be wrong; listing-creation is a separate op).
 *  - Quantities are clamped to a non-negative integer (channels reject negatives/fractions).
 *  - No-op pushes are skipped (channel already equals ERP) to spare the channel's API quota.
 *
 * Pure — no DB / API — so it's unit-testable and the same logic drives every connector's push.
 */
export function computePushUpdates(
  erpAvailable: { code: string; available: number }[],
  channelOnHand: { code: string; onHand: number }[],
): MarketplaceInventoryUpdate[] {
  const current = new Map(channelOnHand.map((c) => [c.code, c.onHand]));
  const out: MarketplaceInventoryUpdate[] = [];
  for (const e of erpAvailable) {
    const cur = current.get(e.code);
    if (cur === undefined) continue; // not listed on this channel → nothing to reconcile
    const want = Math.max(0, Math.floor(Number(e.available) || 0));
    if (cur !== want) out.push({ code: e.code, available: want });
  }
  return out;
}
