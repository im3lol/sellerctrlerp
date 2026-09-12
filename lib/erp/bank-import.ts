/**
 * Bank statement files → statement lines, and platform payouts ↔ deposits. Pure — no DB,
 * no file I/O — so every rule here is unit-tested.
 *
 * Direction is the trap: a bank prints the statement from ITS side, so «دائن / Credit /
 * إيداع» on the file is money that came IN — which bank_statement_lines stores as `debit`.
 * Everything below is named for what it means (moneyIn / moneyOut), never for the column.
 */
export type ParsedLine = { date: Date; description: string; reference: string; moneyIn: number; moneyOut: number };
export type Mapping = { date: number; description: number; reference: number; moneyIn: number; moneyOut: number; amount: number };

const SYN: Record<keyof Mapping, RegExp> = {
  date: /(date|تاريخ)/i,
  description: /(description|details|narrative|particulars|البيان|التفاصيل|الوصف|شرح)/i,
  reference: /(reference|^ref|cheque|check no|المرجع|رقم الشيك)/i,
  moneyIn: /^(credit|credits|deposit|deposits|money in|paid in|cr|دائن|الدائن|إيداع|ايداع|إيداعات|ايداعات|وارد)$/i,
  moneyOut: /^(debit|debits|withdrawal|withdrawals|money out|paid out|dr|مدين|المدين|سحب|مسحوبات|صادر)$/i,
  amount: /^(amount|المبلغ|القيمة)$/i,
};

/** Which column holds what, from the header's own words. -1 = not in this file. */
export function detectMapping(header: unknown[]): Mapping | null {
  const cells = header.map((h) => String(h ?? "").trim());
  const find = (re: RegExp) => cells.findIndex((c) => c !== "" && re.test(c));
  const m: Mapping = {
    date: find(SYN.date), description: find(SYN.description), reference: find(SYN.reference),
    moneyIn: find(SYN.moneyIn), moneyOut: find(SYN.moneyOut), amount: find(SYN.amount),
  };
  const hasMoney = m.moneyIn >= 0 || m.moneyOut >= 0 || m.amount >= 0;
  return m.date >= 0 && hasMoney ? m : null;
}

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/**
 * "1,234.50" · "(1,234.50)" · "1234.50-" · "١٬٢٣٤٫٥٠" · "EGP 50". Thousands separator is
 * the comma, as Egyptian banks print it. ponytail: "1.234,56" (comma decimals) is not
 * handled — add a per-file switch if a bank ever sends it.
 */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw ?? "").trim()
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/٫/g, ".")
    .replace(/[٬,\s]|EGP|ج\.?م\.?/gi, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return neg ? -Number(s) : Number(s);
}

const utc = (y: number, m: number, d: number) => {
  const x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? x : null;
};

/**
 * A statement date: a spreadsheet Date, ISO text, or d/m/yyyy — day first, the Egyptian
 * way, unless the second number can't be a month (then it's an American m/d file).
 */
export function parseBankDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : utc(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  const s = String(raw ?? "").trim().replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return utc(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const [a, b] = [+m[1], +m[2]];
    return b > 12 && a <= 12 ? utc(y, a, b) : utc(y, b, a);
  }
  if (!/[a-z]/i.test(s)) return null; // bare numbers, totals rows
  const d = new Date(s); // "12 Sep 2026", "Sep 12, 2026"
  return Number.isNaN(d.getTime()) ? null : utc(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * The statement's lines. The header is the first of the opening rows that names a date
 * column and a money column (banks put account details above it); rows without a date or
 * without money — opening balance, totals — are counted as skipped, not guessed at.
 */
export function parseBankRows(rows: unknown[][]): { header: string[]; mapping: Mapping | null; lines: ParsedLine[]; skipped: number } {
  const at = rows.slice(0, 25).findIndex((r) => detectMapping(r) !== null);
  if (at < 0) return { header: [], mapping: null, lines: [], skipped: 0 };
  const header = rows[at].map((h) => String(h ?? "").trim());
  const m = detectMapping(rows[at])!;
  const text = (r: unknown[], i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
  const lines: ParsedLine[] = [];
  let skipped = 0;
  for (const r of rows.slice(at + 1)) {
    const date = parseBankDate(r[m.date]);
    let moneyIn = 0, moneyOut = 0;
    if (m.moneyIn >= 0 || m.moneyOut >= 0) {
      moneyIn = Math.abs(m.moneyIn >= 0 ? parseAmount(r[m.moneyIn]) ?? 0 : 0);
      moneyOut = Math.abs(m.moneyOut >= 0 ? parseAmount(r[m.moneyOut]) ?? 0 : 0);
    } else {
      const a = parseAmount(r[m.amount]) ?? 0;
      if (a > 0) moneyIn = a; else moneyOut = -a;
    }
    if (!date || (moneyIn === 0 && moneyOut === 0)) { skipped++; continue; }
    lines.push({ date, description: text(r, m.description), reference: text(r, m.reference), moneyIn, moneyOut });
  }
  return { header, mapping: m, lines, skipped };
}

/** Identity of a line for duplicate detection — the same file uploaded twice adds nothing. */
export const lineKey = (l: ParsedLine) =>
  `${l.date.toISOString().slice(0, 10)}|${l.moneyIn.toFixed(2)}|${l.moneyOut.toFixed(2)}|${l.description}|${l.reference}`;

export type Payout = { id: string; amount: number; date: Date };
export type Deposit = { id: string; date: Date; moneyIn: number };

/**
 * Pair each payout with the deposit of the same amount (±1 for rounding) nearest in date,
 * within `days`. Each deposit is used once; bigger payouts pick first.
 * ponytail: exact-amount only — a bank that nets its own fees off the transfer won't match;
 * add a fee tolerance if one does.
 */
export function matchPayouts(payouts: Payout[], deposits: Deposit[], days = 7): Map<string, Deposit> {
  const used = new Set<string>();
  const out = new Map<string, Deposit>();
  for (const p of [...payouts].sort((a, b) => b.amount - a.amount)) {
    let best: Deposit | null = null;
    let bestGap = Infinity;
    for (const d of deposits) {
      if (used.has(d.id) || Math.abs(d.moneyIn - p.amount) > 1) continue;
      const gap = Math.abs(d.date.getTime() - p.date.getTime()) / 86_400_000;
      if (gap <= days && gap < bestGap) { best = d; bestGap = gap; }
    }
    if (best) { used.add(best.id); out.set(p.id, best); }
  }
  return out;
}
