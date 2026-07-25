import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformCredentials } from "@/db/schema";

export type MarketplaceConnection = {
  connected: boolean;
  sellerId: string | null;
  marketplaceId: string | null;
  region: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  autoSync: boolean;
  needsReauth: boolean;
  realtime: boolean; // ORDER_CHANGE subscription active
};

const EMPTY: MarketplaceConnection = { connected: false, sellerId: null, marketplaceId: null, region: null, lastSyncAt: null, lastSyncStatus: null, autoSync: false, needsReauth: false, realtime: false };

/** Read a tenant's connection for a provider (no secrets exposed). */
export async function getConnection(orgId: string, provider: string): Promise<MarketplaceConnection> {
  const [c] = await db.select({
    sellerId: platformCredentials.sellerId, marketplaceId: platformCredentials.marketplaceId,
    region: platformCredentials.region, lastSyncAt: platformCredentials.lastSyncAt,
    lastSyncStatus: platformCredentials.lastSyncStatus, autoSync: platformCredentials.autoSync,
    needsReauth: platformCredentials.needsReauth,
    notifSubscriptionId: platformCredentials.notifSubscriptionId,
  }).from(platformCredentials)
    .where(and(eq(platformCredentials.organizationId, orgId), eq(platformCredentials.provider, provider.toLowerCase()))).limit(1);
  if (!c) return EMPTY;
  return {
    connected: true, sellerId: c.sellerId, marketplaceId: c.marketplaceId, region: c.region,
    lastSyncAt: c.lastSyncAt ? new Date(c.lastSyncAt).toISOString() : null, lastSyncStatus: c.lastSyncStatus, autoSync: c.autoSync,
    needsReauth: c.needsReauth,
    realtime: !!c.notifSubscriptionId,
  };
}
