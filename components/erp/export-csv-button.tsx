"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import type { ExportResult } from "@/app/actions/erp/exports";

/** Calls a server export action, then downloads the returned CSV (UTF-8 + BOM so
 *  Excel reads Arabic correctly). Works for any entity — pass its export action. */
export function ExportCsvButton({ action, label = "تصدير CSV" }: { action: () => Promise<ExportResult>; label?: string }) {
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await action();
      if (!r.ok) { toast.error(r.error); return; }
      const blob = new Blob(["﻿" + r.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = r.filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    });
  return (
    <Button variant="outline" size="sm" onClick={run} disabled={pending}>
      {pending ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="Download" className="size-4" />}
      {label}
    </Button>
  );
}
