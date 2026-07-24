"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { RefreshCw, ClipboardCheck, Loader2, Settings } from "lucide-react";
import { startInventoryAuditAction } from "@/app/actions/erp/fba-inventory";
import { SyncProgress } from "@/components/erp/sync-progress";
import { AuditProgress } from "@/components/erp/audit-progress";
import { PlatformActions } from "@/components/erp/platform-actions";
import { Button } from "@/components/ui/button";
import type { SyncFlags } from "@/components/erp/marketplace-connect";

/**
 * The platform page's single unified action bar: مزامنة الآن (connected only) ·
 * تدقيق المخزون (connected Amazon only) · استيراد/تصدير · الإعدادات. Replaces the
 * old scatter (sync/audit inside the connect card, import alone in the header).
 */
export function PlatformHeaderActions({
  code, isAmazon, connected, syncFlags, canManage,
}: {
  code: string; isAmazon: boolean; connected: boolean; syncFlags: SyncFlags; canManage: boolean;
}) {
  const [syncOpen, setSyncOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditPending, startAudit] = useTransition();

  const runAudit = () => startAudit(async () => {
    const r = await startInventoryAuditAction(code);
    if (!r.ok) { toast.error(r.error); return; }
    setAuditOpen(true); // background job → progress popup
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {connected && (
        <Button onClick={() => setSyncOpen(true)} disabled={syncOpen}>
          {syncOpen ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}مزامنة الآن
        </Button>
      )}
      {connected && isAmazon && (
        <Button variant="outline" onClick={runAudit} disabled={auditPending} title="مطابقة كميات مخزون FBA مع النظام (قراءة فقط)">
          {auditPending ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}تدقيق المخزون
        </Button>
      )}
      <PlatformActions code={code} isAmazon={isAmazon} />
      {canManage && (
        <Button asChild variant="outline">
          <Link href={`/platforms/${code}/settings`}><Settings className="size-4" />الإعدادات</Link>
        </Button>
      )}
      <SyncProgress code={code} flags={syncFlags} open={syncOpen} onClose={() => setSyncOpen(false)} />
      <AuditProgress code={code} open={auditOpen} onClose={() => setAuditOpen(false)} />
    </div>
  );
}
