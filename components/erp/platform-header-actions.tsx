"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { RefreshCw, ClipboardCheck, Loader2, Settings, HandCoins, Percent, ShoppingCart, ArrowRightLeft, ChevronDown } from "lucide-react";
import { startInventoryAuditAction } from "@/app/actions/erp/fba-inventory";
import { refreshAmazonFeesAction, startOrdersSyncAction } from "@/app/actions/erp/marketplace-sync";
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
  code, isAmazon, connected, syncFlags, hasOrderHistory, canManage,
}: {
  code: string; isAmazon: boolean; connected: boolean; syncFlags: SyncFlags; hasOrderHistory: boolean; canManage: boolean;
}) {
  const [syncOpen, setSyncOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [ioOpen, setIoOpen] = useState(false);       // import/export dialog
  const [pullOpen, setPullOpen] = useState(false);    // سحب المبيعات date dialog
  const [ordersOpen, setOrdersOpen] = useState(false); // orders backfill progress
  const [ordersSince, setOrdersSince] = useState("");
  const [auditPending, startAudit] = useTransition();
  const [feesPending, startFees] = useTransition();
  const [pullPending, startPull] = useTransition();

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

  // Nothing in the dropdown → don't render an empty trigger.
  const hasTools = connected || isAmazon;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {connected && (
        <Button onClick={() => setSyncOpen(true)} disabled={syncOpen}>
          {syncOpen ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}مزامنة الآن
        </Button>
      )}

      {hasTools && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">أدوات<ChevronDown className="size-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
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
            {isAmazon && (
              <DropdownMenuItem asChild>
                <Link href={`/platforms/${code}/reimbursements`}><HandCoins className="size-4" />التعويضات</Link>
              </DropdownMenuItem>
            )}
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
        <SyncProgress code={code} flags={syncFlags} open={syncOpen} onClose={() => setSyncOpen(false)} />
        <AuditProgress code={code} open={auditOpen} onClose={() => setAuditOpen(false)} />
        <OrdersProgress code={code} open={ordersOpen} onClose={() => setOrdersOpen(false)} />
      </div>
    </div>
  );
}
