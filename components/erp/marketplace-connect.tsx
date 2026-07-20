"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plug, PlugZap, Loader2, RefreshCw, ClipboardCheck, ShoppingCart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { disconnectMarketplaceAction, setAutoSyncAction } from "@/app/actions/erp/marketplace-connect";
import { startOrdersSyncAction } from "@/app/actions/erp/marketplace-sync";
import { startInventoryAuditAction } from "@/app/actions/erp/fba-inventory";
import { SyncProgress } from "@/components/erp/sync-progress";
import { AuditProgress } from "@/components/erp/audit-progress";
import { OrdersProgress } from "@/components/erp/orders-progress";
import type { MarketplaceConnection } from "@/lib/erp/marketplace/connection";

export type ConnectMarketplace = { code: string; name: string; marketplaceId: string };

const dt = (s: string | null) => (s ? new Date(s).toLocaleString("ar-EG-u-nu-latn", { dateStyle: "short", timeStyle: "short" }) : "—");

export type SyncFlags = { products: boolean; orders: boolean; inventory: boolean };

export function MarketplaceConnect({
  provider, label, marketplaces, conn, syncFlags, justConnected, error,
}: {
  provider: string; label: string; marketplaces: ConnectMarketplace[];
  conn: MarketplaceConnection; syncFlags: SyncFlags; justConnected?: boolean; error?: string;
}) {
  const [mp, setMp] = useState(marketplaces[0]?.code ?? "");
  const [pending, start] = useTransition();
  const [auditPending, startAudit] = useTransition();
  const [auditOpen, setAuditOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [autoSync, setAutoSync] = useState(conn.autoSync);
  const [ordersSince, setOrdersSince] = useState("");
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [ordersPending, startOrders] = useTransition();

  const runAudit = () => startAudit(async () => {
    const r = await startInventoryAuditAction(provider);
    if (!r.ok) { toast.error(r.error); return; }
    setAuditOpen(true); // background job → show the progress popup
  });

  const syncOrdersFrom = () => startOrders(async () => {
    const r = await startOrdersSyncAction(provider, ordersSince || undefined);
    if (!r.ok) { toast.error(r.error); return; }
    setOrdersOpen(true); // background job → show the progress popup
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
    return (
      <Card className="border-emerald-300/60 dark:border-emerald-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PlugZap className="size-5 text-emerald-600" />ربط {label}<Badge className="bg-emerald-600">مربوط</Badge></CardTitle>
          <CardDescription>
            {justConnected && <span className="text-emerald-600">تم الربط بنجاح. </span>}
            السوق: {market?.name ?? conn.marketplaceId ?? "—"} · معرّف البائع: <span className="font-mono" dir="ltr">{conn.sellerId ?? "—"}</span> · آخر مزامنة: {dt(conn.lastSyncAt)}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setSyncOpen(true)} disabled={syncOpen} className="bg-emerald-600 hover:bg-emerald-700">
            {syncOpen ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}مزامنة الآن
          </Button>
          <Button variant="outline" onClick={runAudit} disabled={auditPending} title="مطابقة كميات مخزون FBA مع النظام وعرض الحالات (قراءة فقط)">
            {auditPending ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}تدقيق المخزون
          </Button>
          <Button variant="outline" onClick={disconnect} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}فصل الحساب
          </Button>
          {/* Sync sales from a chosen start date (one-off / backfill). */}
          <div className="flex w-full flex-wrap items-end gap-2 border-t pt-3">
            <div className="space-y-1.5">
              <label htmlFor="ordersSince" className="text-sm font-medium">مزامنة المبيعات من تاريخ</label>
              <input id="ordersSince" type="date" value={ordersSince} onChange={(e) => setOrdersSince(e.target.value)} className="block h-9 rounded-md border bg-background px-3 text-sm" dir="ltr" />
            </div>
            <Button variant="outline" onClick={syncOrdersFrom} disabled={ordersPending}>
              {ordersPending ? <Loader2 className="size-4 animate-spin" /> : <ShoppingCart className="size-4" />}سحب المبيعات
            </Button>
            <span className="text-xs text-muted-foreground">اتركه فارغًا = آخر ٣٠ يومًا. بيجيب الطلبات من التاريخ ده لحد دلوقتي.</span>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 rounded border-input" checked={autoSync} onChange={(e) => toggleAuto(e.target.checked)} disabled={pending} />
            المزامنة التلقائية (طلبات فورية + اكتشاف منتجات يومي)
          </label>
          <span className="w-full text-xs text-muted-foreground">لما تكون مفعّلة: الطلبات الجديدة من أمازون تدخل النظام تلقائيًا خلال دقائق (وإشعار في الجرس)، والمنتجات الجديدة تُكتشف مرة يوميًا. «مزامنة الآن» تسحب الكتالوج كاملًا.</span>
          <SyncProgress code={provider} flags={syncFlags} open={syncOpen} onClose={() => setSyncOpen(false)} />
          <AuditProgress code={provider} open={auditOpen} onClose={() => setAuditOpen(false)} />
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
