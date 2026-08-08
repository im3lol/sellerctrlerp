import "server-only";
import type { Credential } from "../connector";
import { noonFetch } from "./client";
import { NOON_RETURN_BASE } from "./constants";
import type { PlatformReturnRow } from "@/lib/erp/returns-core";

// Noon FBPI return → neutral PlatformReturnRow[]. The return webhook delivers only the
// return_nr; we GET the full return and map it. Noon's return schema isn't documented,
// so every field is picked defensively across the shapes it plausibly uses (mirrors the
// order mapper). One row per returned line so the returns engine books a credit note per
// SKU against the original order's invoice. Refine the field names once a real payload
// arrives (set NOON_RETURN_PATH / adjust here — no schema is guessed silently).

type NoonReturnItem = {
  partner_sku?: string; sku?: string; mp_item_nr?: string;
  qty?: number; quantity?: number; return_qty?: number;
  reason?: string; return_reason?: string;
  disposition?: string; condition?: string;
};
export type NoonReturn = {
  fbpi_return_nr?: string; return_nr?: string; mp_return_nr?: string;
  fbpi_order_nr?: string; order_nr?: string; mp_order_nr?: string;
  created_at?: string; return_date?: string;
  items?: NoonReturnItem[];
};

const str = (v: unknown) => (v == null ? "" : String(v)).trim();
const qtyOf = (i: NoonReturnItem) => Math.abs(Number(i.return_qty ?? i.qty ?? i.quantity ?? 1)) || 1;

/** Pure: FBPI return payload → neutral return rows (one per line). */
export function mapNoonReturn(r: NoonReturn): PlatformReturnRow[] {
  const returnNr = str(r.fbpi_return_nr ?? r.return_nr ?? r.mp_return_nr);
  const orderId = str(r.fbpi_order_nr ?? r.order_nr ?? r.mp_order_nr);
  const rawDate = str(r.created_at ?? r.return_date);
  const d = rawDate ? new Date(rawDate) : null;
  const returnDate = d && !Number.isNaN(d.getTime()) ? d : null;

  const out: PlatformReturnRow[] = [];
  for (const i of r.items ?? []) {
    const sku = str(i.partner_sku ?? i.sku ?? i.mp_item_nr);
    if (!orderId || !sku) continue; // can't match without both — skip, don't guess
    const qty = qtyOf(i);
    out.push({
      orderId, sku, returnDate, quantity: qty,
      reason: str(i.reason ?? i.return_reason) || null,
      disposition: str(i.disposition ?? i.condition) || null,
      status: null, asin: null,
      // Stable per-line key: same return re-delivered by the webhook dedups.
      dedupKey: ["NOON", returnNr || orderId, sku, String(qty)].join("|"),
      raw: r,
    });
  }
  return out;
}

/** Fetch one FBPI return by its return_nr and map it to neutral rows. */
export async function fetchNoonReturn(cred: Credential, returnNr: string): Promise<PlatformReturnRow[]> {
  const raw = await noonFetch<NoonReturn>(cred.refreshToken, `${NOON_RETURN_BASE}/${encodeURIComponent(returnNr)}/get`);
  return mapNoonReturn(raw);
}
