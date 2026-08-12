/**
 * Line VAT = the org's rate% applied to the taxable base (qty × price − discount).
 * Exempt lines, a zero rate, or a non-positive base all contribute 0. Derived — never
 * hand-typed — so hand-entry documents can't silently post with zero output/input VAT.
 * Shared by every document form + the create actions so the shown tax IS the posted tax.
 *
 * `vatRate` is a percentage (14 → 14%). Rounded to 2 decimals.
 */
export function lineVat(quantity: number, unitPrice: number, discountAmount: number, vatRate: number, exempt = false): number {
  if (exempt || !vatRate || vatRate <= 0) return 0;
  const base = (Number(quantity) || 0) * (Number(unitPrice) || 0) - (Number(discountAmount) || 0);
  if (base <= 0) return 0;
  return Math.round(base * vatRate) / 100; // base * (vatRate/100), 2dp
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Extract the VAT component from a VAT-INCLUSIVE gross amount. Marketplace prices
 * (Amazon/Noon) are what the buyer paid — tax already inside — so the ledger must carve VAT
 * OUT of the gross, not add it on top: net = gross ÷ (1 + rate/100), tax = gross − net.
 * A zero/absent rate or non-positive gross yields tax 0 (net = gross). Rounded to 2dp.
 */
export function extractInclusiveVat(gross: number, vatRate: number): { net: number; tax: number } {
  const g = Number(gross) || 0;
  if (!vatRate || vatRate <= 0 || g <= 0) return { net: r2(g), tax: 0 };
  const net = r2(g / (1 + vatRate / 100));
  return { net, tax: r2(g - net) };
}

/**
 * Split VAT-inclusive marketplace order lines into net unit price + per-line VAT, plus the
 * order's net subtotal and total tax. Each line's GROSS total (`lineTotal`) is preserved, so
 * the order total is unchanged and settlement reconciliation still matches what the channel
 * charged/settled — only the revenue/VAT split moves (revenue was overstated, VAT was 0).
 */
export type InclusiveVatLine = { qty: number; lineTotal: number };
export function splitInclusiveOrderVat(lines: InclusiveVatLine[], vatRate: number): {
  subtotalNet: number; taxTotal: number; lines: { unitPriceNet: number; taxAmount: number }[];
} {
  let subtotalNet = 0, taxTotal = 0;
  const out = lines.map((l) => {
    const { net, tax } = extractInclusiveVat(l.lineTotal, vatRate);
    subtotalNet += net; taxTotal += tax;
    const qty = Number(l.qty) || 0;
    return { unitPriceNet: qty > 0 ? r2(net / qty) : r2(net), taxAmount: tax };
  });
  return { subtotalNet: r2(subtotalNet), taxTotal: r2(taxTotal), lines: out };
}
