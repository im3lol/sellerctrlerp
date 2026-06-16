"use client";

import { useTransition } from "react";
import { RefreshCw, Trash2, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { syncNowAction, deleteSheetConnectionAction } from "@/app/actions/sheets";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { relativeTimeAr } from "@/lib/format";

export function ConnectionCard({
  conn,
}: {
  conn: {
    id: string;
    workspaceName: string | null;
    spreadsheetId: string;
    sheetName: string;
    autoSync: boolean;
    lastSyncAt: Date | null;
    lastSyncStatus: string | null;
  };
}) {
  const [pending, start] = useTransition();
  const ok = conn.lastSyncStatus === "ok" || conn.lastSyncStatus === null;

  const sync = () =>
    start(async () => {
      const res = await syncNowAction(conn.id);
      if (res.ok) toast.success(`تمت المزامنة: ${res.inserted} جديد، ${res.updated} محدّث`);
      else toast.error(res.error ?? "فشلت المزامنة");
    });

  const remove = () =>
    start(async () => {
      await deleteSheetConnectionAction(conn.id);
      toast.success("تم حذف الربط");
    });

  return (
    <Card className="flex flex-row items-center gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-semibold">{conn.workspaceName ?? "—"}</p>
          {conn.autoSync && <Badge variant="secondary">تلقائي</Badge>}
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground" dir="ltr">
          {conn.spreadsheetId} · {conn.sheetName}
        </p>
        <p className="mt-1 flex items-center gap-1 text-xs">
          {ok ? (
            <CheckCircle2 className="size-3.5 text-success" />
          ) : (
            <AlertCircle className="size-3.5 text-destructive" />
          )}
          <span className="text-muted-foreground">
            {conn.lastSyncAt ? `آخر مزامنة ${relativeTimeAr(conn.lastSyncAt)}` : "لم تتم المزامنة بعد"}
          </span>
        </p>
        {!ok && conn.lastSyncStatus && (
          <p className="mt-0.5 truncate text-xs text-destructive">{conn.lastSyncStatus}</p>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={sync} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        مزامنة الآن
      </Button>
      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={remove} disabled={pending}>
        <Trash2 className="size-4" />
      </Button>
    </Card>
  );
}
