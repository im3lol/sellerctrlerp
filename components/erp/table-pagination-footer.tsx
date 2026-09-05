"use client";

import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";

/** Shared "صفحة X من Y" footer row for an in-memory (client-paginated) table body —
 *  used by both the sortable line-item editor and the read-only lines table. */
export function TablePaginationFooter({ page, pages, total, onChange }: { page: number; pages: number; total: number; onChange: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={100} className="p-0">
        <div className="flex items-center justify-between border-t px-3 py-2 text-sm text-muted-foreground">
          <span>صفحة {(page + 1).toLocaleString("ar-EG-u-nu-latn")} من {pages.toLocaleString("ar-EG-u-nu-latn")} — {total.toLocaleString("ar-EG-u-nu-latn")} بند</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page <= 0} onClick={() => onChange(page - 1)}>السابق</Button>
            <Button type="button" variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => onChange(page + 1)}>التالي</Button>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}
