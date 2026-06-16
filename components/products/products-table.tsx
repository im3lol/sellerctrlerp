"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ExternalLink, CheckCircle2, Loader2, EyeOff, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ProductStatusSelect,
  ProductAssigneeSelect,
  type StatusOption,
  type AssigneeOption,
} from "@/components/products/inline-editors";
import { ProductThumb } from "@/components/products/product-thumb";
import { InlineFieldEdit } from "@/components/products/inline-field-edit";
import { ListingButton } from "@/components/products/listing-button";
import { publishProductAction, publishProductsAction } from "@/app/actions/products";
import { useRealtime } from "@/components/realtime/use-realtime";
import type { ProductRow } from "@/lib/queries/products";

/** A draft is "ready to confirm" once its core fields are filled. */
function isReady(p: ProductRow) {
  return !!(p.name && p.imageUrl && p.price);
}

const WS_TYPE_AR: Record<string, string> = {
  amazon: "أمازون",
  noon: "نون",
  brand: "براند",
  other: "أخرى",
};

export function ProductsTable({
  rows,
  statuses,
  assignees,
  canEdit,
  canReview = false,
  showWorkspace = false,
  showAssignee = true,
}: {
  rows: ProductRow[];
  statuses: StatusOption[];
  assignees: AssigneeOption[];
  canEdit: boolean;
  canReview?: boolean;
  showWorkspace?: boolean;
  showAssignee?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, startBulk] = useTransition();

  // Live refresh when any product in a visible workspace changes (§15/§17).
  useRealtime((e) => {
    if (e.type === "product_updated") router.refresh();
  });

  const draftRows = useMemo(() => rows.filter((r) => r.isDraft), [rows]);
  // Show the selection column only to reviewers when drafts are present.
  const selectable = canReview && draftRows.length > 0;
  const draftIds = useMemo(() => draftRows.map((r) => r.id), [draftRows]);
  const readyIds = useMemo(() => draftRows.filter(isReady).map((r) => r.id), [draftRows]);
  const allSelected = draftIds.length > 0 && draftIds.every((id) => selected.has(id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectMany = (ids: string[]) => setSelected(new Set(ids));
  const clearSel = () => setSelected(new Set());

  const confirmSelected = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    startBulk(async () => {
      const res = await publishProductsAction(ids);
      if (res.ok) {
        toast.success(`تم تأكيد ${res.published} منتج وإتاحتها للموظفين`);
        clearSel();
        router.refresh();
      } else {
        toast.error(res.error ?? "تعذّر التأكيد");
      }
    });
  };

  return (
    <div className="space-y-3">
      {selectable && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3">
          <span className="text-sm font-medium">
            {selected.size > 0 ? `محدّد: ${selected.size}` : "تأكيد المسودات"}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => selectMany(draftIds)}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium hover:bg-accent/70"
            >
              تحديد مسودات الصفحة ({draftIds.length})
            </button>
            <button
              type="button"
              onClick={() => selectMany(readyIds)}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium hover:bg-accent/70"
            >
              تحديد الجاهزة بالصفحة ({readyIds.length})
            </button>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={clearSel}
                className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                إلغاء التحديد
              </button>
            )}
          </div>
          <button
            type="button"
            disabled={selected.size === 0 || bulkPending}
            onClick={confirmSelected}
            className="ms-auto inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {bulkPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
            تأكيد المحدد{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            {selectable && (
              <TableHead className="w-10 text-center">
                <input
                  type="checkbox"
                  aria-label="تحديد كل المسودات"
                  checked={allSelected}
                  onChange={(e) => (e.target.checked ? selectMany(draftIds) : clearSel())}
                  className="size-4 cursor-pointer accent-primary"
                />
              </TableHead>
            )}
            <TableHead className="w-14 text-right">الصورة</TableHead>
            <TableHead className="text-right">المنتج</TableHead>
            <TableHead className="text-right">السعر</TableHead>
            {showWorkspace && <TableHead className="text-right">مساحة العمل</TableHead>}
            {/* open columns (app-owned, after the imported data) */}
            {showAssignee && <TableHead className="text-right">المسؤول</TableHead>}
            <TableHead className="text-right">الحالة</TableHead>
            <TableHead className="text-right">ملاحظات</TableHead>
            <TableHead className="text-right">كود المنصة</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.id} className="group" data-selected={selected.has(p.id) || undefined}>
              {selectable && (
                <TableCell className="text-center">
                  {p.isDraft ? (
                    <input
                      type="checkbox"
                      aria-label="تحديد المنتج"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      className="size-4 cursor-pointer accent-primary"
                    />
                  ) : null}
                </TableCell>
              )}
              <TableCell>
                <ProductThumb src={p.imageUrl} name={p.name} />
              </TableCell>
              <TableCell className="max-w-[240px]">
                <div className="flex items-center gap-1.5">
                  <Link href={`/products/${p.id}`} className="truncate font-medium hover:text-primary">
                    {p.name}
                  </Link>
                  {p.isDraft && (
                    <Badge variant="outline" className="shrink-0 gap-1 border-amber-300 bg-amber-50 text-amber-700">
                      <EyeOff className="size-3" />
                      مسودة
                    </Badge>
                  )}
                  {p.productUrl && (
                    <a
                      href={p.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="رابط المنتج على الموقع"
                      className="shrink-0 text-muted-foreground hover:text-primary"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
              </TableCell>
              <TableCell className="tabular-nums text-sm" dir="ltr">
                {p.price ? String(p.price) : "—"}
              </TableCell>
              {showWorkspace && (
                <TableCell className="text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <span>{p.workspaceName}</span>
                    {p.workspaceType && (
                      <Badge variant="outline" className="shrink-0 text-[10px]">{WS_TYPE_AR[p.workspaceType] ?? p.workspaceType}</Badge>
                    )}
                  </div>
                </TableCell>
              )}
              {showAssignee && (
                <TableCell>
                  <ProductAssigneeSelect
                    productId={p.id}
                    assignedTo={p.assignedTo}
                    assignees={assignees}
                    disabled={!canEdit}
                  />
                </TableCell>
              )}
              <TableCell>
                <ProductStatusSelect
                  productId={p.id}
                  statusId={p.statusId}
                  statuses={statuses}
                  disabled={!canEdit}
                />
              </TableCell>
              <TableCell>
                <InlineFieldEdit productId={p.id} field="notes" value={p.notes} multiline placeholder="إضافة ملاحظة" disabled={!canEdit} />
              </TableCell>
              <TableCell>
                <InlineFieldEdit productId={p.id} field="amazonCode" value={p.amazonCode} mono placeholder="إضافة الكود" disabled={!canEdit} />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-0.5">
                  {canEdit && p.isDraft && <PublishButton productId={p.id} />}
                  <ListingButton productId={p.id} variant="icon" />
                  <Link
                    href={`/products/${p.id}`}
                    title="فتح المنتج"
                    className="grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    <ExternalLink className="size-4" />
                  </Link>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">لا توجد منتجات</div>
      )}
      </div>
    </div>
  );
}

/** Confirm a draft product → makes it visible to employees. */
function PublishButton({ productId }: { productId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      title="تأكيد البيانات وإتاحة المنتج للموظفين"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await publishProductAction(productId);
          if (res.ok) toast.success("تم تأكيد المنتج وإتاحته للموظفين");
          else toast.error(res.error ?? "تعذّر التأكيد");
        })
      }
      className="grid size-8 place-items-center rounded-lg text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
    </button>
  );
}
