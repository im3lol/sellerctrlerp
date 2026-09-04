/**
 * Multi-unit conversion. An item is bought by the carton and sold by the piece, but
 * stock, cost and every GL number stay in ONE unit — the item's base unit. So the
 * conversion lives here, at the document's edge: the form converts what the user typed
 * into base before it saves, and the screen converts back for display. Nothing
 * downstream (postStockMovement, costing, valuation, GRNI) ever sees a non-base number.
 *
 * Pure on purpose — no db import — so the rules are testable without a database.
 */

export type ItemUnit = {
  id: string;
  uomId: string;
  label: string;
  /** BASE units contained in one of this unit. The base unit itself is exactly 1. */
  factor: number;
  isBase: boolean;
  barcode?: string | null;
  isActive?: boolean;
};

/** A line as the user typed it, before it is stored. */
export type EnteredLine = {
  /** Quantity in the CHOSEN unit (cartons), not in base units. */
  quantity: number;
  /** Price for one of the CHOSEN unit (price per carton). */
  unitPrice?: number;
  factor: number;
};

/** What actually gets persisted: base quantity, base unit price, and the entry unit. */
export type StoredLine = {
  quantity: number;
  unitPrice: number;
  uomFactor: number;
};

const EPS = 1e-9;

/** Round to 4 dp — the same precision the money helpers use for unit costs. */
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 1e4) / 1e4;
/** Round to 6 dp — factors carry more precision than money (numeric(18,6)). */
const r6 = (n: number) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;

/**
 * Reject a factor that would corrupt every quantity derived from it. A zero or
 * negative factor makes conversion meaningless; a NaN silently poisons the ledger.
 */
export function isValidFactor(factor: unknown): boolean {
  const n = Number(factor);
  return Number.isFinite(n) && n > EPS;
}

/** Entered quantity → base quantity. 5 cartons × 12 = 60 pieces. */
export function toBaseQuantity(quantity: number, factor: number): number {
  if (!isValidFactor(factor)) throw new Error("معامل التحويل غير صالح");
  return r4(Number(quantity) * Number(factor));
}

/** Price per chosen unit → price per base unit. 120 per carton ÷ 12 = 10 per piece. */
export function toBasePrice(unitPrice: number, factor: number): number {
  if (!isValidFactor(factor)) throw new Error("معامل التحويل غير صالح");
  return r4(Number(unitPrice) / Number(factor));
}

/** Base quantity → the display quantity in the line's own unit. */
export function fromBaseQuantity(baseQuantity: number, factor: number): number {
  if (!isValidFactor(factor)) return Number(baseQuantity);
  return r6(Number(baseQuantity) / Number(factor));
}

/** Convert one typed line into what the tables store. */
export function storeLine(line: EnteredLine): StoredLine {
  const factor = Number(line.factor);
  return {
    quantity: toBaseQuantity(line.quantity, factor),
    unitPrice: toBasePrice(line.unitPrice ?? 0, factor),
    uomFactor: r6(factor),
  };
}

/**
 * How a stored line reads on screen: "٥ كرتونة (٦٠ قطعة)". Returns null when the line
 * is in the base unit anyway — then there is nothing to explain and the plain quantity
 * is the honest display.
 */
export function displayQuantity(
  baseQuantity: number,
  factor: number | null | undefined,
  unitLabel: string | null | undefined,
  baseLabel: string | null | undefined,
): { primary: number; primaryLabel: string; secondary: string | null } {
  const f = Number(factor ?? 1);
  const base = Number(baseQuantity);
  if (!isValidFactor(f) || Math.abs(f - 1) < EPS || !unitLabel) {
    return { primary: base, primaryLabel: baseLabel ?? "", secondary: null };
  }
  const inUnit = fromBaseQuantity(base, f);
  const baseQty = base.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
  return { primary: inUnit, primaryLabel: unitLabel, secondary: `${baseQty} ${baseLabel ?? ""}`.trim() };
}

/**
 * The unit list a picker shows. Guarantees exactly one base row even when the stored
 * rows are wrong (a hand-edited factor, a missing base row), because a picker with no
 * base option is a dead end for the user.
 */
export function unitOptions(units: ItemUnit[], baseLabel: string): ItemUnit[] {
  const valid = units.filter((u) => isValidFactor(u.factor) && u.isActive !== false);
  const base = valid.filter((u) => u.isBase);
  const rest = valid.filter((u) => !u.isBase);
  if (base.length === 1) return [base[0], ...rest];
  // No base row (or several) — synthesise the canonical one and drop any impostors.
  return [{ id: "__base__", uomId: "", label: baseLabel, factor: 1, isBase: true }, ...rest];
}

/**
 * Pick the unit a scanned barcode belongs to. Scanning the carton barcode should add a
 * carton, not a piece — that is the whole point of a per-unit barcode.
 */
export function unitForBarcode(units: ItemUnit[], scanned: string): ItemUnit | null {
  const norm = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const target = norm(scanned);
  if (!target) return null;
  return units.find((u) => u.barcode && norm(u.barcode) === target) ?? null;
}

/**
 * Validate a unit set before saving it. Returns an Arabic error, or null when it is
 * safe: exactly one base at factor 1, no duplicate unit, every factor positive, and no
 * barcode used twice (a barcode that matches two units cannot be scanned).
 */
export function validateUnitSet(units: { uomId: string; factor: number; isBase: boolean; barcode?: string | null }[]): string | null {
  if (!units.length) return null;
  const bases = units.filter((u) => u.isBase);
  if (bases.length !== 1) return "لازم وحدة أساسية واحدة بالظبط";
  if (Math.abs(Number(bases[0].factor) - 1) > EPS) return "معامل الوحدة الأساسية لازم يكون ١";
  for (const u of units) {
    if (!isValidFactor(u.factor)) return "كل معامل تحويل لازم يكون أكبر من صفر";
  }
  const uoms = new Set<string>();
  for (const u of units) {
    if (uoms.has(u.uomId)) return "الوحدة مكرّرة — كل وحدة مرة واحدة للصنف";
    uoms.add(u.uomId);
  }
  const codes = new Set<string>();
  for (const u of units) {
    const b = (u.barcode ?? "").trim();
    if (!b) continue;
    if (codes.has(b)) return "الباركود مكرّر بين وحدتين — مش هيعرف يقرأه";
    codes.add(b);
  }
  return null;
}
