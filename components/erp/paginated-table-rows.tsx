"use client";

import { useState, type ReactNode } from "react";
import { TablePaginationFooter } from "@/components/erp/table-pagination-footer";

/**
 * Client-side 10-per-page wrapper for a read-only document's line-items table —
 * drop inside a <Table><TableBody>. Takes already-rendered <TableRow> elements (not a
 * render-prop) so a server-component detail page can use it directly: functions can't
 * cross the server→client boundary, but rendered JSX can.
 */
export function PaginatedTableRows({ rows, pageSize = 10 }: { rows: ReactNode[]; pageSize?: number }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const start = safePage * pageSize;

  return (
    <>
      {rows.slice(start, start + pageSize)}
      <TablePaginationFooter page={safePage} pages={pages} total={rows.length} onChange={setPage} />
    </>
  );
}
