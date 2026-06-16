"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ProductStatusSelect,
  ProductAssigneeSelect,
  type StatusOption,
  type AssigneeOption,
} from "@/components/products/inline-editors";
import { ProductThumb } from "@/components/products/product-thumb";
import { useRealtime } from "@/components/realtime/use-realtime";
import type { ProductRow } from "@/lib/queries/products";

export function ProductsTable({
  rows,
  statuses,
  assignees,
  canEdit,
  showWorkspace = false,
}: {
  rows: ProductRow[];
  statuses: StatusOption[];
  assignees: AssigneeOption[];
  canEdit: boolean;
  showWorkspace?: boolean;
}) {
  const router = useRouter();

  // Live refresh when any product in a visible workspace changes (§15/§17).
  useRealtime((e) => {
    if (e.type === "product_updated") router.refresh();
  });

  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-14 text-right">الصورة</TableHead>
            <TableHead className="text-right">المنتج</TableHead>
            <TableHead className="text-right">البراند</TableHead>
            <TableHead className="text-right">السعر</TableHead>
            {showWorkspace && <TableHead className="text-right">مساحة العمل</TableHead>}
            {/* open columns (app-owned, after the imported data) */}
            <TableHead className="text-right">المسؤول</TableHead>
            <TableHead className="text-right">حالة المنصة</TableHead>
            <TableHead className="text-right">ملاحظات</TableHead>
            <TableHead className="text-right">كود المنصة</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.id} className="group">
              <TableCell>
                <ProductThumb src={p.imageUrl} name={p.name} />
              </TableCell>
              <TableCell className="max-w-[220px]">
                <Link href={`/products/${p.id}`} className="font-medium hover:text-primary">
                  {p.name}
                </Link>
                {p.asin && (
                  <span className="block font-mono text-xs text-muted-foreground" dir="ltr">
                    {p.asin}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{p.brand ?? "—"}</TableCell>
              <TableCell className="tabular-nums text-sm" dir="ltr">
                {p.price ? `${p.price} ر.س` : "—"}
              </TableCell>
              {showWorkspace && (
                <TableCell className="text-sm text-muted-foreground">{p.workspaceName}</TableCell>
              )}
              <TableCell>
                <ProductAssigneeSelect
                  productId={p.id}
                  assignedTo={p.assignedTo}
                  assignees={assignees}
                  disabled={!canEdit}
                />
              </TableCell>
              <TableCell>
                <ProductStatusSelect
                  productId={p.id}
                  statusId={p.statusId}
                  statuses={statuses}
                  disabled={!canEdit}
                />
              </TableCell>
              <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground">
                {p.notes ?? "—"}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground" dir="ltr">
                {p.amazonCode ?? "—"}
              </TableCell>
              <TableCell>
                <Link
                  href={`/products/${p.id}`}
                  className="grid size-8 place-items-center rounded-lg text-muted-foreground opacity-0 transition hover:bg-accent group-hover:opacity-100"
                >
                  <ExternalLink className="size-4" />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">لا توجد منتجات</div>
      )}
    </div>
  );
}
