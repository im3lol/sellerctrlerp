"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plug, PlugZap, Loader2, ShoppingCart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { disconnectMarketplaceAction, setAutoSyncAction } from "@/app/actions/erp/marketplace-connect";
import { startOrdersSyncAction } from "@/app/actions/erp/marketplace-sync";
import { OrdersProgress } from "@/components/erp/orders-progress";
import type { MarketplaceConnection } from "@/lib/erp/marketplace/connection";

export type ConnectMarketplace = { code: string; name: string; marketplaceId: string };

const dt = (s: string | null) => (s ? new Date(s).toLocaleString("ar-EG-u-nu-latn", { dateStyle: "short", timeStyle: "short" }) : "—");

export type SyncFlags = { products: boolean; orders: boolean; inventory: boolean };

/**
 * Connection STATUS card only — the sync/audit buttons live in the page header
 * (PlatformHeaderActions). Here: connected badge + market/seller/last-sync,
 * auto-sync switch, backfill-orders-from-date, and disconnect.
 */
export function MarketplaceConnect({
  provider, label, marketplaces, conn, justConnected, error,
}: {
  provider: string; label: string; marketplaces: ConnectMarketplace[];
  conn: MarketplaceConnection; justConnected?: boolean; error?: string;
}) {
  const [mp, setMp] = useState(marketplaces[0]?.code ?? "");
  const [pending, start] = useTransition();
  const [autoSync, setAutoSync] = useState(conn.autoSync);
  const [ordersSince, setOrdersSince] = useState("");
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [ordersPending, startOrders] = useTransition();

  const syncOrdersFrom = () => startOrders(async () => {
    const r = await startOrdersSyncAction(provider, ordersSince || undefined);
    if (!r.ok) { toast.error(r.error); return; }
    setOrdersOpen(true); // background job → progress popup
  });

  const disconnect = () => start(async () => {
    const r = await disconnectMarketplaceAction(provider);
    if (r.ok) toast.success(`تم فصل حساب ${label}`);
    else toast.error(r.error);
  });

  const toggleAuto = (next: boolean) => {
    setAutoSync(next);
    start(async () => {
      const r = await setAutoSyncAction(provider, next);
      if (r.ok) toast.success(next ? "تم تفعيل المزامنة التلقائية" : "تم إيقاف المزامنة التلقائية");
      else { setAutoSync(!next); toast.error(r.error); }
    });
  };

  if (conn.connected) {
    const market = marketplaces.find((m) => m.marketplaceId === conn.marketplaceId);
    const reconnectMp = market?.code ?? marketplaces[0]?.code ?? "";
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
                <a href={`/api/erp/marketplace/${provider}/connect?marketplace=${reconnectMp}`}><Plug className="size-4" />إعادة ربط الحساب</a>
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">المزامنة التلقائية</div>
              <div className="text-xs text-muted-foreground">الطلبات الجديدة تدخل النظام تلقائيًا خلال دقائق (وإشعار في الجرس)، والمنتجات الجديدة تُكتشف يوميًا.</div>
            </div>
            <Switch checked={autoSync} onCheckedChange={toggleAuto} disabled={pending} />
          </div>

          {/* Backfill: pull sales from a chosen start date (one-off). */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <label htmlFor="ordersSince" className="text-sm font-medium">سحب المبيعات من تاريخ</label>
              <input id="ordersSince" type="date" value={ordersSince} onChange={(e) => setOrdersSince(e.target.value)} className="block h-9 rounded-md border bg-background px-3 text-sm" dir="ltr" />
            </div>
            <Button variant="outline" onClick={syncOrdersFrom} disabled={ordersPending}>
              {ordersPending ? <Loader2 className="size-4 animate-spin" /> : <ShoppingCart className="size-4" />}سحب المبيعات
            </Button>
            <span className="text-xs text-muted-foreground">اتركه فارغًا = اليوم فقط (الطلبات الجديدة) — أو ابدأ من تاريخ بدء الربط المحاسبي.</span>
          </div>
          <OrdersProgress code={provider} open={ordersOpen} onClose={() => setOrdersOpen(false)} />
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
    </Card>
  );
}
