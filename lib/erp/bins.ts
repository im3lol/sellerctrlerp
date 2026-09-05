/**
 * Bin locations. A bin says where to walk to find an item — it is a picking dimension,
 * never a balance one. Quantities and value stay at warehouse level and `stock_batches`
 * keeps its identity, so nothing here can move a number in the accounts.
 *
 * The one piece of real logic is route order. A pick list walked in the order the lines
 * happen to be in sends someone up and down the same aisle three times; walked in bin
 * order it is one pass. Which means bin codes have to sort the way the warehouse is
 * actually laid out — and "A-10" must come after "A-2", not before it.
 *
 * Pure — no db — so the ordering is testable.
 */

export type Bin = { id: string; code: string; nameAr?: string | null };

export type PickLine<T> = T & { binCode: string | null };

/**
 * Split a code into text and number chunks so a natural sort can compare them properly.
 * "A-10-3" → ["A", 10, 3]. Without this "A-10" sorts before "A-2" and the route is
 * wrong in exactly the warehouses big enough to need one.
 */
export function codeChunks(code: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /(\d+)|(\D+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code ?? "")) !== null) {
    if (m[1] != null) { out.push(Number(m[1])); continue; }
    // Separators normalise away entirely — a lone "-" between two numbers must not
    // become an empty chunk, or "A-10-3" and "A-10 3" stop comparing equal.
    const text = m[2].toUpperCase().replace(/[\s_./\-]+/g, "");
    if (text) out.push(text);
  }
  return out;
}

/** Natural comparison of two bin codes — the walking order. */
export function compareBinCodes(a: string, b: string): number {
  const ca = codeChunks(a);
  const cb = codeChunks(b);
  for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
    const x = ca[i];
    const y = cb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x - y;
    } else {
      const sx = String(x), sy = String(y);
      if (sx !== sy) return sx < sy ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Order the lines of a pick into one pass through the warehouse. Items with no bin go
 * last: someone has to hunt for them, and that is better done after the easy ones are
 * already on the trolley.
 */
export function sortPickRoute<T>(lines: PickLine<T>[]): PickLine<T>[] {
  return [...lines].sort((a, b) => {
    if (!a.binCode && !b.binCode) return 0;
    if (!a.binCode) return 1;
    if (!b.binCode) return -1;
    return compareBinCodes(a.binCode, b.binCode);
  });
}

/** Sort bins for display — same order as the route, so the list reads like the aisle. */
export function sortBins<T extends Bin>(bins: T[]): T[] {
  return [...bins].sort((a, b) => compareBinCodes(a.code, b.code));
}

/**
 * Validate a bin code before saving. Returns an Arabic error or null. Codes are the
 * route, so a blank or absurd one breaks the ordering for everything after it.
 */
export function validateBinCode(code: string, existing: string[] = []): string | null {
  const c = (code ?? "").trim();
  if (!c) return "كود الموقع مطلوب";
  if (c.length > 32) return "الكود أطول من ٣٢ خانة";
  if (!/[A-Za-z0-9؀-ۿ]/.test(c)) return "الكود لازم يحتوي حرف أو رقم";
  const norm = (s: string) => s.trim().toUpperCase();
  if (existing.some((e) => norm(e) === norm(c))) return "الكود مستخدم في نفس المستودع";
  return null;
}

/**
 * Where an item can be found, best first. The primary bin leads; the rest follow in
 * route order, so a picker who finds the pick face empty knows where to go next.
 */
export function locationsFor(
  assignments: { binId: string; isPrimary: boolean }[],
  bins: Bin[],
): Bin[] {
  const byId = new Map(bins.map((b) => [b.id, b]));
  const primary = assignments.filter((a) => a.isPrimary).map((a) => byId.get(a.binId)).filter((b): b is Bin => !!b);
  const rest = assignments.filter((a) => !a.isPrimary).map((a) => byId.get(a.binId)).filter((b): b is Bin => !!b);
  return [...sortBins(primary), ...sortBins(rest)];
}
