/**
 * Foreign-currency helpers for the purchase cycle. Pure.
 *
 * A rate always means: **1 unit of the document currency = `rate` units of base**.
 *
 * The rule this file serves: **one approved rate runs the whole cycle.** Whoever raises
 * the purchase order picks the rate — the one recorded for that day, one they choose off
 * the list, or one they type — and the receipt and the invoice carry that same number.
 *
 * They are not free to disagree. A shipment valued one way when it arrives and another
 * when it is billed leaves a residue in the goods-received-not-invoiced account that
 * nobody can ever explain, and gives two different answers to "what did this cost me".
 * The buyer who negotiated the deal knows which rate the deal was struck at; the system's
 * job is to carry that decision forward, not to second-guess it on every document.
 */

/** A rate has to be a positive number; zero means "no rate on file", never "free". */
export function validateRate(rate: number): string | null {
  if (!Number.isFinite(rate)) return "سعر الصرف لازم يكون رقم";
  if (rate <= 0) return "سعر الصرف لازم يكون أكبر من صفر";
  if (rate > 1_000_000) return "سعر الصرف كبير بشكل غير معقول — راجع الرقم";
  return null;
}

/** Base → document currency, at 4dp: a display figure, not a posted one. */
export const toForeign = (base: number, rate: number): number =>
  rate > 0 ? Math.round((base / rate) * 10000) / 10000 : 0;

/**
 * Was the rate on this document chosen by a person, or just the one on file?
 *
 * Answered by comparing, not by trusting a flag the form sent: a form that always posts
 * the rate — even the untouched default — would otherwise mark every foreign document
 * "manual", which is worse than not recording it at all because it looks like information.
 */
export function rateSourceOf(submitted: number | null | undefined, auto: number): "MANUAL" | "AUTO" {
  if (submitted == null || !(submitted > 0)) return "AUTO";
  return Math.abs(submitted - auto) > 1e-9 ? "MANUAL" : "AUTO";
}

export type RateChoice = { date: string; rate: number };

/**
 * The rate a document should DEFAULT to: the newest one recorded on or before its own
 * date. Not the newest one overall — an order dated last month must not be priced with
 * today's rate just because today's is the last row in the table. It is only a default;
 * the person raising the document can pick another or type their own.
 */
export function rateAsOf(rates: RateChoice[], date: string): RateChoice | null {
  const day = date.slice(0, 10);
  const eligible = rates.filter((r) => r.date.slice(0, 10) <= day && r.rate > 0);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, r) => (r.date.slice(0, 10) > best.date.slice(0, 10) ? r : best));
}
