import { sql, type SQLWrapper } from "drizzle-orm";

/**
 * The invoice lifecycle, in one place.
 *
 * `PARTIAL_PAID` is written by confirmReceiptVoucherAction / confirmPaymentVoucherAction
 * when a payment only partly settles an invoice. It is the status most often
 * forgotten, and forgetting it is expensive: an invoice that was 1000 and took a
 * 300 receipt is no longer POSTED, so any filter naming POSTED explicitly drops it
 * along with the 700 it still owes.
 *
 * Two real bugs came from re-typing this vocabulary per call site — the AR/AP aging
 * pages filtered `status = 'POSTED'` and understated receivables, and the VAT report
 * filtered a misspelled `'PARTIALLY_PAID'` that matches nothing, under-declaring
 * output VAT. Import from here instead of writing the strings again.
 */
export const INVOICE_STATUSES = ["DRAFT", "POSTED", "PARTIAL_PAID", "PAID", "CANCELLED"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Statuses of an invoice that represents a real, countable transaction. */
export const LIVE_INVOICE_STATUSES: InvoiceStatus[] = ["POSTED", "PARTIAL_PAID", "PAID"];

/**
 * SQL predicate for "this invoice counts" — everything except an unposted draft
 * and a cancelled document. Expressed as an exclusion rather than a list so a new
 * status is counted by default; the failure mode of an over-broad filter (a number
 * appears) is far cheaper than that of an under-broad one (revenue and tax go
 * silently missing from a report someone files).
 */
export const liveInvoice = (statusCol: SQLWrapper) =>
  sql`${statusCol} NOT IN ('DRAFT','CANCELLED')`;
