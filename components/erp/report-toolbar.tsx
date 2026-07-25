"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

/**
 * Standard actions for a report page: download Excel (when an export route is
 * given) + print / save-as-PDF. Marked `no-print` so the buttons themselves
 * never appear in the printed output (globals.css hides the app chrome on print).
 */
/**
 * `printHref` opens the report's formatted A4 print view (ReportSheet) in a new
 * tab — pass it with the page's CURRENT filters in the querystring. Without it
 * the button falls back to raw window.print() (legacy page-print).
 */
export function ReportToolbar({ excel, printHref }: { excel?: string; printHref?: string }) {
  return (
    <div className="no-print flex flex-wrap gap-2">
      {excel && (
        <Button asChild variant="outline">
          <a href={excel}><Icon name="Download" className="size-4" />Excel</a>
        </Button>
      )}
      {printHref ? (
        <Button asChild variant="outline">
          <a href={printHref} target="_blank" rel="noopener"><Icon name="Printer" className="size-4" />طباعة / PDF</a>
        </Button>
      ) : (
        <Button variant="outline" onClick={() => window.print()}>
          <Icon name="Printer" className="size-4" />طباعة / PDF
        </Button>
      )}
    </div>
  );
}
