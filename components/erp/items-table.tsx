"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Loader2 } from "lucide-react";
import { bulkDeleteItemsAction, type ItemsFilter } from "@/app/actions/erp/items";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Row = { id: string; code: string; nameAr: string | null; image: string | null; sellPrice: string | null; isActive: boolean; parentItemId: string | null; codeCount: number; childCount: number };
const money = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n: number) => Number(n).toLocaleString("ar-EG-u-nu-latn");

export function ItemsTable({ rows, total, canDelete, filter }: { rows: Row[]; total: number; canDelete: boolean; filter: ItemsFilter }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [allPages, setAllPages] = useState(false);
  const [pending, start] = useTransition();

  const pageIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => sel.has(id));
  const count = allPages ? total : sel.size;
  const hasMorePages = total > rows.length;

  const toggle = (id: string) => {
    setAllPages(false);
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const togglePage = () => { setAllPages(false); setSel(allOnPage ? new Set() : new Set(pageIds)); };
  const clearAll = () => { setSel(new Set()); setAllPages(false); };

  const del = () => start(async () => {
    const r = allPages
      ? await bulkDeleteItemsAction({ all: filter })
      : await bulkDeleteItemsAction({ ids: [...sel] });
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`تم حذف ${int(r.deleted)} صنف${r.blocked ? ` · ${int(r.blocked)} مرتبط بحركات لم يُحذف` : ""}`);
    clearAll();
    router.refresh();
  });

  return (
    <div className="space-y-3">
      {canDelete && count > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <span className="font-medium">{allPages ? `كل الـ${int(total)} صنف محدّد` : `${int(sel.size)} محدّد`}</span>
          {!allPages && allOnPage && hasMorePages && (
            <button type="button" className="text-primary underline" onClick={() => setAllPages(true)}>حدّد كل الـ{int(total)} صنف في كل الصفحات</button>
          )}
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={clearAll}>إلغاء التحديد</button>
          <div className="ms-auto">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={pending}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}حذف المحدّد ({int(count)})
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>حذف {int(count)} صنف؟</AlertDialogTitle>
                  <AlertDialogDescription>لا يمكن التراجع. الأصناف المرتبطة بحركات أو أوامر لن تُحذف وسيتم تجاهلها.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>إلغاء</AlertDialogCancel>
                  <AlertDialogAction onClick={del} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">حذف</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            {canDelete && (
              <TableHead className="w-10">
                <input type="checkbox" aria-label="تحديد كل الصفحة" className="size-4 rounded border-input" checked={allPages || allOnPage} ref={(el) => { if (el) el.indeterminate = !allPages && !allOnPage && pageIds.some((id) => sel.has(id)); }} onChange={togglePage} />
              </TableHead>
            )}
            <TableHead className="text-start w-14">الصورة</TableHead>
            <TableHead className="text-start">الكود</TableHead>
            <TableHead className="text-start">الاسم</TableHead>
            <TableHead className="text-start">الأكواد</TableHead>
            <TableHead className="text-start">سعر البيع</TableHead>
            <TableHead className="text-start">الحالة</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const checked = allPages || sel.has(r.id);
            return (
              <TableRow key={r.id} data-state={checked ? "selected" : undefined}>
                {canDelete && (
                  <TableCell>
                    <input type="checkbox" aria-label="تحديد" className="size-4 rounded border-input" checked={checked} disabled={allPages} onChange={() => toggle(r.id)} />
                  </TableCell>
                )}
                <TableCell>
                  <div className="size-9 overflow-hidden rounded-md border bg-muted/40">
                    {r.image
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={r.image} alt="" className="size-full object-contain" />
                      : <div className="flex size-full items-center justify-center text-muted-foreground"><Icon name="Image" className="size-4" /></div>}
                  </div>
                </TableCell>
                <TableCell className="font-mono"><Link href={`/inventory/items/${encodeURIComponent(r.code)}`} className="text-primary underline">{r.code}</Link></TableCell>
                <TableCell className="max-w-[360px]">
                  <div className="flex items-center gap-2">
                    <div className="truncate" title={r.nameAr ?? ""}>{r.nameAr ?? "—"}</div>
                    {Number(r.childCount) > 0
                      ? <Badge variant="outline" className="shrink-0 gap-1"><Icon name="Boxes" className="size-3" />أب · {int(r.childCount)}</Badge>
                      : r.parentItemId ? <Badge variant="outline" className="shrink-0 text-muted-foreground">تنويعة</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>{Number(r.codeCount) > 0 ? <Badge variant="secondary">{int(r.codeCount)}</Badge> : "—"}</TableCell>
                <TableCell>{money(r.sellPrice)}</TableCell>
                <TableCell><Badge variant={r.isActive ? "default" : "secondary"}>{r.isActive ? "نشط" : "متوقف"}</Badge></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
