import { describe, it, expect } from "vitest";
import {
  activePromotions, lineDiscount, applyPromotions, spreadDiscount,
  type Promotion, type PromoLine,
} from "@/lib/erp/promotions";
import {
  earnedPoints, pointsValue, maxRedeemable, validateRedeem, pointsBalance, OFF,
  type LoyaltyProgram,
} from "@/lib/erp/loyalty";

const promo = (over: Partial<Promotion> = {}): Promotion => ({
  id: "p1", nameAr: "عرض", type: "PERCENT", value: 10, itemId: "i1",
  minQuantity: 0, minAmount: 0, buyQty: 0, getQty: 0,
  startsAt: null, endsAt: null, priority: 0, ...over,
});

const line = (over: Partial<PromoLine> = {}): PromoLine =>
  ({ itemId: "i1", quantity: 1, unitPrice: 100, discount: 0, ...over });

describe("when a rule is in force", () => {
  const at = new Date("2026-09-05T12:00:00Z");

  it("a rule with no dates always is", () => {
    expect(activePromotions([promo()], at)).toHaveLength(1);
  });

  it("has not started yet", () => {
    expect(activePromotions([promo({ startsAt: "2026-09-06" })], at)).toHaveLength(0);
  });

  it("still counts on its last day", () => {
    expect(activePromotions([promo({ endsAt: "2026-09-05" })], at)).toHaveLength(1);
    expect(activePromotions([promo({ endsAt: "2026-09-04" })], at)).toHaveLength(0);
  });
});

describe("what one rule takes off", () => {
  it("a percentage of the line", () => {
    expect(lineDiscount(promo({ value: 10 }), line({ quantity: 2 }))).toBe(20);
  });

  it("an amount per unit, capped at the line itself", () => {
    expect(lineDiscount(promo({ type: "AMOUNT", value: 15 }), line({ quantity: 3 }))).toBe(45);
    expect(lineDiscount(promo({ type: "AMOUNT", value: 500 }), line({ quantity: 1 }))).toBe(100);
  });

  it("nothing, when the line is a different item", () => {
    expect(lineDiscount(promo({ itemId: "other" }), line())).toBe(0);
  });

  it("nothing, below the minimum quantity or amount", () => {
    expect(lineDiscount(promo({ minQuantity: 3 }), line({ quantity: 2 }))).toBe(0);
    expect(lineDiscount(promo({ minAmount: 500 }), line({ quantity: 1 }))).toBe(0);
  });

  describe("buy X get Y", () => {
    const bogo = promo({ type: "BUY_X_GET_Y", buyQty: 2, getQty: 1 });

    it("gives a free one per complete group", () => {
      expect(lineDiscount(bogo, line({ quantity: 3 }))).toBe(100);
      expect(lineDiscount(bogo, line({ quantity: 6 }))).toBe(200);
    });

    it("gives nothing for a part of a group", () => {
      expect(lineDiscount(bogo, line({ quantity: 2 }))).toBe(0);
      expect(lineDiscount(bogo, line({ quantity: 5 }))).toBe(100);
    });
  });
});

describe("a cart against the rules", () => {
  it("takes the best rule for a line, not both", () => {
    const r = applyPromotions([line({ quantity: 2 })], [
      promo({ id: "small", value: 10 }),
      promo({ id: "big", value: 25 }),
    ]);
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0].promotionId).toBe("big");
    expect(r.lines[0].discount).toBe(50);
  });

  it("never undercuts a discount the cashier typed by hand", () => {
    const r = applyPromotions([line({ discount: 40 })], [promo({ value: 10 })]);
    expect(r.lines[0].discount).toBe(40);
    expect(r.applied).toHaveLength(0);
  });

  it("applies a basket rule once, after the line rules", () => {
    const r = applyPromotions(
      [line({ itemId: "i1", quantity: 1, unitPrice: 300 }), line({ itemId: "i2", quantity: 1, unitPrice: 200 })],
      [promo({ id: "cart", itemId: null, type: "PERCENT", value: 10, minAmount: 400 })],
    );
    expect(r.applied.map((a) => a.promotionId)).toEqual(["cart"]);
    expect(r.total).toBe(450);
    expect(r.lines.reduce((s, l) => s + l.discount, 0)).toBe(50);
  });

  it("leaves a basket rule alone when the basket is too small", () => {
    const r = applyPromotions([line()], [promo({ itemId: null, value: 10, minAmount: 400 })]);
    expect(r.applied).toHaveLength(0);
    expect(r.total).toBe(100);
  });

  it("does nothing at all with no rules", () => {
    const r = applyPromotions([line({ quantity: 2 })], []);
    expect(r.total).toBe(200);
    expect(r.applied).toHaveLength(0);
  });
});

describe("spreading a basket discount", () => {
  it("splits by weight and loses not one piastre", () => {
    const out = spreadDiscount([line({ unitPrice: 300 }), line({ unitPrice: 200 })], 50);
    expect(out[0].discount).toBe(30);
    expect(out[1].discount).toBe(20);
  });

  it("puts an indivisible remainder on the last line rather than dropping it", () => {
    const out = spreadDiscount([line({ unitPrice: 100 }), line({ unitPrice: 100 }), line({ unitPrice: 100 })], 10);
    expect(out.reduce((s, l) => s + l.discount, 0)).toBe(10);
  });
});

// ── loyalty ─────────────────────────────────────────────────────────────
const program: LoyaltyProgram = { earnRate: 1, redeemRate: 0.5, minRedeem: 50 };

describe("loyalty points", () => {
  it("earns whole points only", () => {
    expect(earnedPoints(249.9, program)).toBe(249);
    expect(earnedPoints(100, { ...program, earnRate: 0.1 })).toBe(10);
  });

  it("earns nothing when the programme is off", () => {
    expect(earnedPoints(1000, OFF)).toBe(0);
  });

  it("is a sum of its ledger, refunds included", () => {
    expect(pointsBalance([{ points: 200 }, { points: -50 }, { points: 30 }])).toBe(180);
  });

  it("values points at the redeem rate", () => {
    expect(pointsValue(120, program)).toBe(60);
  });
});

describe("redeeming", () => {
  it("caps at the balance and at the sale — points are not cash back", () => {
    expect(maxRedeemable(1000, 100, program)).toBe(200);
    expect(maxRedeemable(80, 1000, program)).toBe(80);
  });

  it("gives nothing below the joining threshold or with the programme off", () => {
    expect(maxRedeemable(40, 1000, program)).toBe(0);
    expect(maxRedeemable(1000, 1000, OFF)).toBe(0);
  });

  it("refuses more than the customer has", () => {
    expect(validateRedeem(300, 100, 1000, program)).toMatch(/رصيد العميل/);
  });

  it("refuses more than the sale is worth", () => {
    expect(validateRedeem(1000, 5000, 100, program)).toMatch(/مبتترجعش كاش/);
  });

  it("refuses under the threshold, and fractions, and nothing", () => {
    expect(validateRedeem(10, 20, 500, program)).toMatch(/بيبدأ من/);
    expect(validateRedeem(10.5, 500, 500, program)).toMatch(/صحيحة/);
    expect(validateRedeem(0, 500, 500, program)).toMatch(/أكبر من صفر/);
  });

  it("accepts an honest redemption", () => {
    expect(validateRedeem(100, 500, 500, program)).toBeNull();
  });
});
