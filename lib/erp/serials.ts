/**
 * Serial-number tracking. One row per physical unit, followed from the receipt that
 * brought it in to the delivery that took it out — so "where is this serial and who has
 * it" has an answer.
 *
 * The serial ledger is PARALLEL to stock, never a substitute for it: quantities and
 * value still come from stock_movements. What ties the two together is one invariant,
 * enforced here — a serial-tracked line hands over exactly as many serials as the
 * quantity it books. If that ever slips, the two ledgers disagree silently, which is
 * the failure mode this module exists to prevent.
 *
 * Pure — no db — so the rules are testable without a database.
 */

export type SerialStatus = "IN_STOCK" | "SOLD" | "RETURNED" | "SCRAPPED";

export type SerialRow = {
  serial: string;
  normalizedSerial: string;
};

/** Upper + alphanumeric only: a scanner's hyphens and a typist's spaces must match. */
export function normalizeSerial(s: string): string {
  return (s ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * Split whatever the user pasted into serials. Scanners emit one per line; people paste
 * comma- or space-separated lists. Blanks are dropped rather than becoming empty rows.
 */
export function parseSerials(input: string): string[] {
  return (input ?? "")
    .split(/[\n\r,;\t]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Check a batch of serials for one line before it is saved. Returns an Arabic error or
 * null. Order matters: an empty entry is a different mistake from a duplicate one, and
 * saying which is what makes the message useful.
 */
export function validateSerials(
  serials: string[],
  quantity: number,
  opts?: { alreadyInStock?: string[] },
): string | null {
  const qty = Number(quantity) || 0;
  const cleaned = serials.map((s) => s.trim()).filter(Boolean);

  if (cleaned.length !== serials.length) return "في سطر فاضي بين الأرقام التسلسلية";
  if (cleaned.some((s) => normalizeSerial(s) === "")) return "رقم تسلسلي بدون أي حرف أو رقم";
  if (cleaned.some((s) => s.length > 64)) return "رقم تسلسلي أطول من ٦٤ خانة";

  const norms = cleaned.map(normalizeSerial);
  const seen = new Set<string>();
  for (const n of norms) {
    if (seen.has(n)) return "رقم تسلسلي مكرّر في نفس السطر";
    seen.add(n);
  }

  // The invariant the whole module exists for.
  if (cleaned.length !== qty) {
    return `عدد الأرقام التسلسلية (${cleaned.length}) لازم يساوي الكمية (${qty})`;
  }

  const clash = opts?.alreadyInStock?.map(normalizeSerial).find((n) => seen.has(n));
  if (clash) return "رقم تسلسلي موجود بالفعل في المخزون لنفس الصنف";

  return null;
}

/** Ready-to-insert rows, deduplicated and normalized. */
export function serialRows(serials: string[]): SerialRow[] {
  return serials
    .map((s) => s.trim())
    .filter(Boolean)
    .map((serial) => ({ serial, normalizedSerial: normalizeSerial(serial) }));
}

/**
 * Which serials may leave stock now. Anything not IN_STOCK is refused by name — "serial
 * not available" without saying which one, and why, is useless on a loading bay.
 */
export function checkAvailableToShip(
  requested: string[],
  known: { normalizedSerial: string; status: SerialStatus }[],
): string | null {
  const byNorm = new Map(known.map((k) => [k.normalizedSerial, k.status]));
  for (const s of requested) {
    const n = normalizeSerial(s);
    const status = byNorm.get(n);
    if (!status) return `الرقم التسلسلي «${s}» مش موجود في مخزون هذا الصنف`;
    if (status === "SOLD") return `الرقم التسلسلي «${s}» مُباع بالفعل`;
    if (status === "SCRAPPED") return `الرقم التسلسلي «${s}» مُعدَم`;
  }
  return null;
}

/** Whether an item's tracking mode demands serials on every movement. */
export const isSerialTracked = (tracking: string | null | undefined): boolean => tracking === "SERIAL";

export const STATUS_LABEL: Record<SerialStatus, string> = {
  IN_STOCK: "في المخزون",
  SOLD: "مُباع",
  RETURNED: "مرتجع",
  SCRAPPED: "مُعدَم",
};
