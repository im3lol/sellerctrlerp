"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { RefreshCw, ClipboardCheck, Loader2, Settings, HandCoins, Percent, ShoppingCart, ArrowRightLeft, ChevronDown, Link2, Wallet, Image as ImageIcon, Boxes, Warehouse } from "lucide-react";
import { startInventoryAuditAction } from "@/app/actions/erp/fba-inventory";
import { refreshAmazonFeesAction, startOrdersSyncAction, startImagesSyncAction } from "@/app/actions/erp/marketplace-sync";
import { updatePlatformAction } from "@/app/actions/erp/platforms";
import { SyncProgress } from "@/components/erp/sync-progress";
import { AuditProgress } from "@/components/erp/audit-progress";
import { OrdersProgress } from "@/components/erp/orders-progress";
import { PlatformActions } from "@/components/erp/platform-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { SyncFlags } from "@/components/erp/marketplace-connect";

/**
 * The platform page's unified action bar: مزامنة الآن (primary) · «أدوات» dropdown
 * (تدقيق المخزون · تحديث الرسوم · التعويضات · استيراد/تصدير · سحب المبيعات) · الإعدادات.
 * Everything but the two primary actions is folded into the dropdown to keep the
 * header uncluttered.
 */
export function PlatformHeaderActions({
  code, label, platformId, isAmazon, connected, syncFlags, hasOrderHistory, hasStartDate, canManage,
}: {
  code: string; label: string; platformId: string; isAmazon: boolean; connected: boolean; syncFlags: SyncFlags; hasOrderHistory: boolean; hasStartDate: boolean; canManage: boolean;
}) {
  const [syncOpen, setSyncOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [ioOpen, setIoOpen] = useState(false);       // import/export dialog
  const [pullOpen, setPullOpen] = useState(false);    // سحب المبيعات date dialog
  const [ordersOpen, setOrdersOpen] = useState(false); // orders backfill progress
  const [ordersSince, setOrdersSince] = useState("");
  // «مزامنة الآن» chooser: the seller PICKS what to sync (products/orders/inventory)
  // instead of a blanket everything-run. Hosts the go-live gate too: no accounting
  // start date yet + orders selected → the same dialog asks for the date first.
  const [chooseOpen, setChooseOpen] = useState(false);
  const [chosen, setChosen] = useState<SyncFlags>(syncFlags);
  const [startDate, setStartDate] = useState("");
  const [startSaved, setStartSaved] = useState(false);
  const [runFlags, setRunFlags] = useState<SyncFlags | null>(null); // this run's selection
  const [auditPending, startAudit] = useTransition();
  const [feesPending, startFees] = useTransition();
  const [pullPending, startPull] = useTransition();
  const [imagesPending, startImages] = useTransition();
  const [startPending, startSave] = useTransition();

  const runAudit = () => startAudit(async () => {
    const r = await startInventoryAuditAction(code);
    if (!r.ok) { toast.error(r.error); return; }
    setAuditOpen(true);
  });

  const refreshFees = () => startFees(async () => {
    const r = await refreshAmazonFeesAction(code);
    if (r.ok) toast.success("بدأ تحديث رسوم أمازون — النتائج تظهر في تقرير الربحية خلال دقائق");
    else toast.error(r.error ?? "تعذّر بدء التحديث");
  });

  const pullOrders = () => startPull(async () => {
    const r = await startOrdersSyncAction(code, ordersSince || undefined);
    if (!r.ok) { toast.error(r.error); return; }
    setPullOpen(false);
    setOrdersOpen(true);
  });

  // On-demand image sync: backfill images for items still missing one (Catalog API).
  const syncImages = () => startImages(async () => {
    const r = await startImagesSyncAction(code);
    if (r.ok) toast.success(r.started ? "بدأت مزامنة الصور في الخلفية — الصور الناقصة تُجلب من أمازون" : "اكتملت مزامنة الصور — حدّث صفحة المنتجات");
    else toast.error(r.error ?? "تعذّر بدء مزامنة الصور");
  });

  // Start the chosen sync. If orders are selected with no go-live date yet: save the
  // date first, backfill orders from it (queued, its own progress card), and let the
  // normal popup run the remaining selected stages.
  const beginSync = () => startSave(async () => {
    const sel = { ...chosen };
    if (!sel.products && !sel.orders && !sel.inventory) { toast.error("اختر مصدرًا واحدًا على الأقل"); return; }
    const needDate = sel.orders && !hasStartDate && !startSaved;
    if (needDate) {
      if (!startDate) { toast.error("اختر تاريخ بدء المحاسبة أولًا"); return; }
      const u = await updatePlatformAction(platformId, { accountingStartDate: startDate });
      if ("error" in u && u.error) { toast.error(u.error); return; }
      setStartSaved(true);
      const r = await startOrdersSyncAction(code, startDate);
      if (r.ok) setOrdersOpen(true);
      else toast.error(r.error ?? "تعذّر بدء سحب المبيعات — أعد المحاولة من «أدوات»");
      sel.orders = false; // the backfill owns orders this run
    }
    setChooseOpen(false);
    if (sel.products || sel.orders || sel.inventory) { setRunFlags(sel); setSyncOpen(true); }
  });

  // Nothing in the dropdown → don't render an empty trigger.
  const hasTools = connected || isAmazon;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {connected && (
        <Button onClick={() => { setChosen(syncFlags); setChooseOpen(true); }} disabled={syncOpen}>
          {syncOpen ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}مزامنة الآن
        </Button>
      )}

      {hasTools && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">أدوات<ChevronDown className="size-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {connected && (
              <DropdownMenuItem asChild>
                <Link href={`/platforms/${code}/verify`}><Link2 className="size-4" />تحقق من ربط {label}</Link>
              </DropdownMenuItem>
            )}
            {connected && isAmazon && (
              <DropdownMenuItem onClick={runAudit} disabled={auditPending}>
                <ClipboardCheck className="size-4" />تدقيق المخزون
              </DropdownMenuItem>
            )}
            {connected && isAmazon && (
              <DropdownMenuItem onClick={refreshFees} disabled={feesPending}>
                <Percent className="size-4" />تحديث الرسوم
              </DropdownMenuItem>
            )}
            {connected && isAmazon && (
              <DropdownMenuItem onClick={syncImages} disabled={imagesPending}>
                <ImageIcon className="size-4" />مزامنة الصور
              </DropdownMenuItem>
            )}
            {isAmazon && (
              <DropdownMenuItem asChild>
                <Link href={`/platforms/${code}/reimbursements`}><HandCoins className="size-4" />التعويضات</Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link href={`/platforms/${code}/fees`}><Percent className="size-4" />مصاريف التسويات</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/platforms/${code}/payouts`}><Wallet className="size-4" />المحفظة والمدفوعات</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIoOpen(true)}>
              <ArrowRightLeft className="size-4" />استيراد / تصدير
            </DropdownMenuItem>
            {connected && (
              <>
                <DropdownMenuSeparator />
                {/* First pull asks for a start date (historical backfill); once the
                    platform has an orders watermark, run incrementally with no prompt. */}
                <DropdownMenuItem onClick={() => (hasOrderHistory ? pullOrders() : setPullOpen(true))} disabled={pullPending}>
                  <ShoppingCart className="size-4" />سحب المبيعات
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {canManage && (
        <Button asChild variant="outline">
          <Link href={`/platforms/${code}/settings`}><Settings className="size-4" />الإعدادات</Link>
        </Button>
      )}

      {/* «مزامنة الآن» chooser: pick exactly what to sync. Also hosts the one-time
          go-live date question — without it the order floor silently lands on today. */}
      <Dialog open={chooseOpen} onOpenChange={setChooseOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>مزامنة {label}</DialogTitle>
            <DialogDescription>اختر ما تريد مزامنته الآن — كل مصدر يعمل مستقلًا.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5">
            {([
              { key: "products" as const, label: "المنتجات", desc: "الأصناف + الصور والبيانات", icon: <Boxes className="size-4" /> },
              { key: "orders" as const, label: "المبيعات", desc: "استيراد الطلبات ودورتها المحاسبية", icon: <ShoppingCart className="size-4" /> },
              { key: "inventory" as const, label: "المخزون (تدقيق)", desc: "مقارنة كميات المنصّة بالنظام — قراءة فقط", icon: <Warehouse className="size-4" /> },
            ]).map((s) => (
              <label key={s.key} className={`flex items-start gap-3 rounded-lg border p-3 ${syncFlags[s.key] ? "cursor-pointer" : "opacity-50"}`}>
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={chosen[s.key]}
                  disabled={!syncFlags[s.key]}
                  onChange={(e) => setChosen((c) => ({ ...c, [s.key]: e.target.checked }))}
                />
                <span className="flex items-center gap-2 text-sm font-medium">{s.icon}{s.label}</span>
                <span className="mr-auto text-xs text-muted-foreground">{syncFlags[s.key] ? s.desc : "موقوف من إعدادات المنصّة"}</span>
              </label>
            ))}
          </div>
          {chosen.orders && !hasStartDate && !startSaved && (
            <div className="space-y-1.5 rounded-lg border border-dashed p-3">
              <label htmlFor="goLiveDate" className="text-sm font-medium">تاريخ بدء المحاسبة</label>
              <p className="text-xs text-muted-foreground">من أي تاريخ نبدأ محاسبة مبيعات {label}؟ الطلبات من هذا التاريخ تُستورد وتُحاسَب؛ الأقدم يُتجاهل. يُحفظ مرة واحدة ويمكن تعديله من الإعدادات.</p>
              <input id="goLiveDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="block h-9 rounded-md border bg-background px-3 text-sm" dir="ltr" />
            </div>
          )}
          <DialogFooter>
            <Button onClick={beginSync} disabled={startPending}>
              {startPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}بدء المزامنة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* سحب المبيعات: pick a start date (blank = today only). */}
      <Dialog open={pullOpen} onOpenChange={setPullOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>سحب المبيعات</DialogTitle>
            <DialogDescription>اترك التاريخ فارغًا لسحب طلبات اليوم فقط، أو ابدأ من تاريخ بدء الربط المحاسبي.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="ordersSince" className="text-sm font-medium">من تاريخ</label>
            <input id="ordersSince" type="date" value={ordersSince} onChange={(e) => setOrdersSince(e.target.value)} className="block h-9 rounded-md border bg-background px-3 text-sm" dir="ltr" />
          </div>
          <DialogFooter>
            <Button onClick={pullOrders} disabled={pullPending}>
              {pullPending ? <Loader2 className="size-4 animate-spin" /> : <ShoppingCart className="size-4" />}سحب المبيعات
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PlatformActions code={code} isAmazon={isAmazon} open={ioOpen} onOpenChange={setIoOpen} />
      {/* All background-job cards share one anchor and stack vertically so
          concurrent syncs never overlap. Each renders null when closed. */}
      <div className="fixed bottom-24 left-4 z-[60] flex flex-col gap-3">
        <SyncProgress
          code={code}
          label={label}
          flags={runFlags ?? syncFlags}
          auditInventory={isAmazon}
          open={syncOpen}
          onClose={() => { setSyncOpen(false); setRunFlags(null); }}
        />
        <AuditProgress code={code} open={auditOpen} onClose={() => setAuditOpen(false)} />
        <OrdersProgress code={code} label={label} open={ordersOpen} onClose={() => setOrdersOpen(false)} />
      </div>
    </div>
  );
}
