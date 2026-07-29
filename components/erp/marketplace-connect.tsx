"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plug, PlugZap, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { disconnectMarketplaceAction } from "@/app/actions/erp/marketplace-connect";
import type { MarketplaceConnection } from "@/lib/erp/marketplace/connection";

export type ConnectMarketplace = { code: string; name: string; marketplaceId: string };

const dt = (s: string | null) => (s ? new Date(s).toLocaleString("ar-EG-u-nu-latn", { dateStyle: "short", timeStyle: "short" }) : "—");

export type SyncFlags = { products: boolean; orders: boolean; inventory: boolean };

/**
 * Connection STATUS card only — connected badge + market/seller/last-sync +
 * disconnect (+ re-auth banner). Sync/audit/import and «سحب المبيعات» live in the
 * page-header «أدوات» dropdown; the auto-sync toggle lives in الإعدادات.
 */
export function MarketplaceConnect({
  provider, label, marketplaces, conn, justConnected, error, needsShop,
}: {
  provider: string; label: string; marketplaces: ConnectMarketplace[];
  conn: MarketplaceConnection; justConnected?: boolean; error?: string;
  /** Shop-domain-first connectors (Shopify): show a store-domain input instead of a
   *  marketplace picker; connect via ?shop= instead of ?marketplace=. */
  needsShop?: boolean;
}) {
  const [mp, setMp] = useState(marketplaces[0]?.code ?? "");
  const [shop, setShop] = useState("");
  const [pending, start] = useTransition();
  const shopValid = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop.trim().toLowerCase());

  const disconnect = () => start(async () => {
    const r = await disconnectMarketplaceAction(provider);
    if (r.ok) toast.success(`تم فصل حساب ${label}`);
    else toast.error(r.error);
  });

  if (conn.connected) {
    const market = marketplaces.find((m) => m.marketplaceId === conn.marketplaceId);
    const reconnectMp = market?.code ?? marketplaces[0]?.code ?? "";
    const reconnectHref = needsShop
      ? `/api/erp/marketplace/${provider}/connect?shop=${encodeURIComponent(conn.sellerId ?? "")}`
      : `/api/erp/marketplace/${provider}/connect?marketplace=${reconnectMp}`;
    return (
      <Card className={conn.needsReauth ? "border-destructive/60" : "border-emerald-300/60 dark:border-emerald-500/30"}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2"><PlugZap className="size-5 text-emerald-600" />ربط {label}<Badge className="bg-emerald-600">مربوط</Badge>{conn.realtime && <Badge variant="secondary" title="طلبات أمازون الجديدة تصل خلال ثوانٍ عبر إشعارات فورية">التحديث الفوري مفعّل ⚡</Badge>}</CardTitle>
              <CardDescription className="mt-1.5">
                {justConnected && <span className="text-emerald-600">تم الربط بنجاح. </span>}
                السوق: {market?.name ?? conn.marketplaceId ?? "—"} · معرّف البائع: <span className="font-mono" dir="ltr">{conn.sellerId ?? "—"}</span> · آخر مزامنة: {dt(conn.lastSyncAt)}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={disconnect} disabled={pending} className="text-muted-foreground">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}فصل الحساب
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {conn.needsReauth && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5">
              <div className="text-sm font-medium text-destructive">
                انتهت صلاحية ربط {label} — توقفت المزامنة التلقائية حتى تعيد ربط الحساب.
              </div>
              <Button asChild size="sm" variant="destructive">
                <a href={reconnectHref}><Plug className="size-4" />إعادة ربط الحساب</a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Plug className="size-5" />ربط {label}</CardTitle>
        <CardDescription>{error ? <span className="text-destructive">تعذّر الربط: {error}</span> : `اربط حساب ${label} لسحب الأوامر والتسويات والمخزون تلقائيًا بدل رفع الملفات يدويًا.`}</CardDescription>
      </CardHeader>
      {needsShop ? (
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">دومين المتجر</label>
            <input
              value={shop} onChange={(e) => setShop(e.target.value)} dir="ltr" placeholder="store.myshopify.com"
              className="block h-9 w-64 rounded-md border bg-background px-3 text-sm"
            />
          </div>
          <Button asChild disabled={!shopValid}>
            <a href={shopValid ? `/api/erp/marketplace/${provider}/connect?shop=${encodeURIComponent(shop.trim().toLowerCase())}` : undefined}>
              <Plug className="size-4" />ربط {label}
            </a>
          </Button>
        </CardContent>
      ) : (
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">السوق</label>
            <select value={mp} onChange={(e) => setMp(e.target.value)} className="block h-9 rounded-md border bg-background px-3 text-sm">
              {marketplaces.map((m) => <option key={m.code} value={m.code}>{m.name} ({m.code})</option>)}
            </select>
          </div>
          <Button asChild>
            <a href={`/api/erp/marketplace/${provider}/connect?marketplace=${mp}`}><Plug className="size-4" />ربط {label}</a>
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
