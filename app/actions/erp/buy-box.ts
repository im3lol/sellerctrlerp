"use server";

import { authorizeErp } from "@/lib/erp/action-auth";
import { prepareSync, syncOffersCore } from "@/lib/erp/marketplace/sync-core";
import { enqueue, QUEUES } from "@/lib/queue/queues";

/** Refresh the Buy Box picture now — in the background when the queue is up, inline otherwise. */
export async function startOffersRefreshAction(code: string): Promise<{ ok: boolean; error?: string; started?: boolean }> {
  const auth = await authorizeErp("sales.view", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  const p = await prepareSync(auth.orgId, code);
  if ("error" in p) return { ok: false, error: p.error };
  if (!p.connector.fetchOffers) return { ok: false, error: "المنصة لا تدعم مراقبة الأسعار" };

  if (await enqueue(QUEUES.offers, { orgId: p.orgId, provider: p.provider, marketplaceId: p.cred.marketplaceId ?? undefined })) {
    return { ok: true, started: true };
  }
  const r = await syncOffersCore(p);
  return r.ok ? { ok: true, started: false } : { ok: false, error: r.error };
}
