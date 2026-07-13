"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plug, PlugZap, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { disconnectMarketplaceAction, setAutoSyncAction } from "@/app/actions/erp/marketplace-connect";
import { SyncProgress } from "@/components/erp/sync-progress";
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
  const [syncOpen, setSyncOpen] = useState(false);
  const [autoSync, setAutoSync] = useState(conn.autoSync);

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
          <Button variant="outline" onClick={disconnect} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}فصل الحساب
          </Button>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 rounded border-input" checked={autoSync} onChange={(e) => toggleAuto(e.target.checked)} disabled={pending} />
            مزامنة تلقائية (كل دقيقة)
          </label>
          <span className="w-full text-xs text-muted-foreground">تسحب المنتجات (ربط/إنشاء) والمبيعات (آخر ٣٠ يوم) والمخزون (مطابقة تؤكّدها). التسويات تُرفع يدويًا. المزامنة التلقائية تجيب المبيعات الجديدة أول بأول.</span>
          <SyncProgress code={provider} flags={syncFlags} open={syncOpen} onClose={() => setSyncOpen(false)} />
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
