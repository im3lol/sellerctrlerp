/**
 * Automatic retail discounts. Pure: given a cart, the rules, and the moment, it says what
 * comes off and why.
 *
 * The rule that shapes everything here: **a line takes one promotion, the best one.**
 * Stacking is where retail margins quietly disappear — two rules that each looked
 * reasonable meet on one line and sell it under cost. If a shop wants a bigger discount
 * it writes a bigger rule, and can see the number it wrote.
 */

export type PromotionType = "PERCENT" | "AMOUNT" | "BUY_X_GET_Y";

export type Promotion = {
  id: string;
  nameAr: string;
  type: PromotionType;
  /** Percent for PERCENT, pounds per unit for AMOUNT, ignored for BUY_X_GET_Y. */
  value: number;
  /** Null means the whole basket: a cart rule, applied once after the line rules. */
  itemId: string | null;
  minQuantity: number;
  minAmount: number;
  buyQty: number;
  getQty: number;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
};

export type PromoLine = { itemId: string; quantity: number; unitPrice: number; discount: number };
export type AppliedPromo = { promotionId: string; nameAr: string; amount: number };

const round = (n: number) => Math.round(n * 100) / 100;

/** In force right now — a rule with no dates is always in force. */
export function activePromotions(promos: Promotion[], at: Date = new Date()): Promotion[] {
  const t = at.getTime();
  return promos.filter((p) => {
    if (p.startsAt && new Date(p.startsAt).getTime() > t) return false;
    // The end date is a day, and a rule that ends today is still good today.
    if (p.endsAt && new Date(`${p.endsAt.slice(0, 10)}T23:59:59.999Z`).getTime() < t) return false;
    return true;
  });
}

/** What one rule takes off one line — 0 when it does not reach the line at all. */
export function lineDiscount(promo: Promotion, line: PromoLine): number {
  if (promo.itemId !== line.itemId) return 0;
  const gross = line.quantity * line.unitPrice;
  if (line.quantity < promo.minQuantity) return 0;
  if (gross < promo.minAmount) return 0;

  switch (promo.type) {
    case "PERCENT":
      return round(gross * (promo.value / 100));
    case "AMOUNT":
      // Per unit, so buying three of something gets the offer three times.
      return round(Math.min(promo.value * line.quantity, gross));
    case "BUY_X_GET_Y": {
      const group = promo.buyQty + promo.getQty;
      if (group <= 0 || promo.getQty <= 0) return 0;
      // Only whole groups pay off; four items on a 2+1 offer is one free, not one and a bit.
      const free = Math.floor(line.quantity / group) * promo.getQty;
      return round(Math.min(free * line.unitPrice, gross));
    }
  }
}

/**
 * Runs the rules over a cart. Line rules first, one per line; then a cart rule on what is
 * left. A discount the cashier typed by hand is a floor — a promotion may beat it, never
 * undercut it.
 */
export function applyPromotions(
  lines: PromoLine[],
  promos: Promotion[],
  at: Date = new Date(),
): { lines: PromoLine[]; applied: AppliedPromo[]; total: number } {
  const live = activePromotions(promos, at);
  const lineRules = live.filter((p) => p.itemId !== null);
  const cartRules = live.filter((p) => p.itemId === null);
  const applied: AppliedPromo[] = [];

  const out = lines.map((line) => {
    let best: { promo: Promotion; amount: number } | null = null;
    for (const promo of lineRules) {
      const amount = lineDiscount(promo, line);
      if (amount <= 0) continue;
      if (!best || amount > best.amount || (amount === best.amount && promo.priority > best.promo.priority)) {
        best = { promo, amount };
      }
    }
    if (!best || best.amount <= line.discount) return line;
    applied.push({ promotionId: best.promo.id, nameAr: best.promo.nameAr, amount: round(best.amount - line.discount) });
    return { ...line, discount: round(best.amount) };
  });

  const net = round(out.reduce((s, l) => s + l.quantity * l.unitPrice - l.discount, 0));

  // One cart rule, the best one — same no-stacking rule, one level up.
  let bestCart: { promo: Promotion; amount: number } | null = null;
  for (const promo of cartRules) {
    if (net < promo.minAmount) continue;
    const amount = promo.type === "PERCENT" ? round(net * (promo.value / 100)) : round(Math.min(promo.value, net));
    if (amount <= 0) continue;
    if (!bestCart || amount > bestCart.amount) bestCart = { promo, amount };
  }

  if (bestCart) {
    applied.push({ promotionId: bestCart.promo.id, nameAr: bestCart.promo.nameAr, amount: bestCart.amount });
    // Spread it across the lines by weight, so the invoice keeps one discount concept and
    // the profit report still knows which item was sold cheap.
    const spread = spreadDiscount(out, bestCart.amount);
    return { lines: spread, applied, total: round(net - bestCart.amount) };
  }

  return { lines: out, applied, total: net };
}

/** Push a basket-level discount down onto the lines, biggest line first, cents and all. */
export function spreadDiscount(lines: PromoLine[], amount: number): PromoLine[] {
  const nets = lines.map((l) => l.quantity * l.unitPrice - l.discount);
  const total = nets.reduce((s, n) => s + n, 0);
  if (total <= 0 || amount <= 0) return lines;

  let left = round(amount);
  const out = lines.map((l, i) => {
    const share = i === lines.length - 1 ? left : Math.min(round((amount * nets[i]) / total), left);
    left = round(left - share);
    return { ...l, discount: round(l.discount + share) };
  });
  return out;
}
