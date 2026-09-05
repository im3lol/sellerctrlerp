/**
 * The offline sale queue — pure, so the rules in docs/POS-OFFLINE.md can be tested
 * without a browser. Storage and networking live in the terminal component; everything
 * that decides *what happens to a sale* lives here.
 *
 * The one rule the whole file exists to enforce: a sale that took money never leaves the
 * queue by accident. It leaves when the server confirms an invoice, or when a human
 * cancels it on purpose. Failure moves it to a visible exception, never to nowhere.
 */

import type { PaymentMethod } from "@/lib/erp/pos";

export type QueuedLine = { itemId: string; label: string; quantity: number; unitPrice: number; discount: number };
export type QueuedPayment = { method: PaymentMethod; amount: number; reference?: string | null };

export type QueuedSale = {
  /** Generated on the device before the sale is stored. The idempotency key. */
  clientRef: string;
  /** When the till took the money — not when it synced. */
  soldAt: string;
  shiftId: string;
  customerId: string;
  lines: QueuedLine[];
  payments: QueuedPayment[];
  applyVat: boolean;
  vatRate: number;
  total: number;
  status: "PENDING" | "SYNCED" | "FAILED";
  attempts: number;
  error?: string | null;
  invoiceNumber?: string | null;
};

/** Cash and card only offline — credit needs a live customer balance. See the doc. */
export const OFFLINE_METHODS: PaymentMethod[] = ["CASH", "CARD"];

export function newClientRef(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // ponytail: only reached on ancient browsers; Math.random is enough for a per-device key
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** A sale is only allowed into the offline queue if it can be posted without the server. */
export function canQueueOffline(sale: Pick<QueuedSale, "payments" | "lines">): string | null {
  if (sale.lines.length === 0) return "السلة فاضية";
  if (sale.payments.length === 0) return "أدخل طريقة دفع";
  const bad = sale.payments.find((p) => !OFFLINE_METHODS.includes(p.method));
  if (bad) return "بدون إنترنت الدفع كاش أو بطاقة بس — الآجل محتاج رصيد العميل";
  return null;
}

/** Adds a sale, or returns the queue untouched if that key is already in it. */
export function enqueue(queue: QueuedSale[], sale: QueuedSale): QueuedSale[] {
  if (queue.some((s) => s.clientRef === sale.clientRef)) return queue;
  return [...queue, sale];
}

const patch = (queue: QueuedSale[], clientRef: string, fields: Partial<QueuedSale>): QueuedSale[] =>
  queue.map((s) => (s.clientRef === clientRef ? { ...s, ...fields } : s));

export function markSynced(queue: QueuedSale[], clientRef: string, invoiceNumber?: string | null): QueuedSale[] {
  return patch(queue, clientRef, { status: "SYNCED", invoiceNumber: invoiceNumber ?? null, error: null });
}

/**
 * A failed sale stays in the queue as an exception. `attempts` climbs so the UI can stop
 * hammering a sale that will never post — but the sale itself is never dropped.
 */
export function markFailed(queue: QueuedSale[], clientRef: string, error: string): QueuedSale[] {
  const current = queue.find((s) => s.clientRef === clientRef);
  return patch(queue, clientRef, { status: "FAILED", error, attempts: (current?.attempts ?? 0) + 1 });
}

/** Put a failed sale back in line — after someone fixed whatever blocked it. */
export function retry(queue: QueuedSale[], clientRef: string): QueuedSale[] {
  return patch(queue, clientRef, { status: "PENDING", error: null });
}

/** The only way a sale leaves the queue unposted: a human said so. */
export function discard(queue: QueuedSale[], clientRef: string): QueuedSale[] {
  return queue.filter((s) => s.clientRef !== clientRef);
}

export const pending = (queue: QueuedSale[]) => queue.filter((s) => s.status === "PENDING");
export const failed = (queue: QueuedSale[]) => queue.filter((s) => s.status === "FAILED");

/** How many sales are still money the books have not seen. */
export const unsettledCount = (queue: QueuedSale[]) =>
  queue.filter((s) => s.status !== "SYNCED").length;

/**
 * Rule 4: the drawer reconciles from what the till took, not from what posted. Sales
 * still sitting in the queue count as cash in the drawer, otherwise every offline sale
 * reads as a shortage the cashier gets blamed for.
 */
export function drawerAdjustment(queue: QueuedSale[]): { cash: number; card: number; sales: number } {
  let cash = 0, card = 0, sales = 0;
  for (const s of queue) {
    if (s.status === "SYNCED") continue; // already counted by the server
    sales += s.total;
    for (const p of s.payments) {
      if (p.method === "CASH") cash += p.amount;
      else if (p.method === "CARD") card += p.amount;
    }
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { cash: r(cash), card: r(card), sales: r(sales) };
}

/**
 * Drop synced sales once there are enough of them to clutter the device. Kept briefly so
 * the cashier can still see "that one went through" right after it does.
 */
export function prune(queue: QueuedSale[], keepSynced = 20): QueuedSale[] {
  const synced = queue.filter((s) => s.status === "SYNCED");
  if (synced.length <= keepSynced) return queue;
  const drop = new Set(synced.slice(0, synced.length - keepSynced).map((s) => s.clientRef));
  return queue.filter((s) => !drop.has(s.clientRef));
}

/** Oldest first — a queue replays in the order the till rang it. */
export function syncOrder(queue: QueuedSale[]): QueuedSale[] {
  return pending(queue).slice().sort((a, b) => a.soldAt.localeCompare(b.soldAt));
}
