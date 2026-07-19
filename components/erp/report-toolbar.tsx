"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

/**
 * Standard actions for a report page: download Excel (when an export route is
 * given) + print / save-as-PDF. Marked `no-print` so the buttons themselves
 * never appear in the printed output (globals.css hides the app chrome on print).
 */
export function ReportToolbar({ excel }: { excel?: string }) {
  return (
    <div className="no-print flex flex-wrap gap-2">
      {excel && (
        <Button asChild variant="outline">
          <a href={excel}><Icon name="Download" className="size-4" />Excel</a>
        </Button>
      )}
      <Button variant="outline" onClick={() => window.print()}>
        <Icon name="Printer" className="size-4" />طباعة / PDF
      </Button>
    </div>
  );
}
