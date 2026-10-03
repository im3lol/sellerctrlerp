"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { useFormStatus } from "react-dom";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveInvestorAction, deleteInvestorAction, bulkDeleteInvestorsAction } from "@/app/actions/erp/investors";
import type { ActionState } from "@/lib/erp/action-auth";
import { useSelection, BulkDeleteBar, SelectBox } from "@/components/erp/bulk-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export type Investor = {
  id: string; code: string; fullName: string; phone: string | null; email: string | null; nationalId: string | null; status: string;
};

function SubmitBtn() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>;
}

function InvestorDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing: Investor | null }) {
  const t = useT();
  const [state, formAction] = useActionState<ActionState, FormData>(saveInvestorAction, {});
  useEffect(() => {
    if (state.ok) { toast.success("تم الحفظ"); onOpenChange(false); }
    else if (state.error) toast.error(state.error);
  }, [state, onOpenChange]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form action={formAction} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? t("تعديل مستثمر") : t("مستثمر جديد")}</DialogTitle>
            <DialogDescription>{t("بيانات المستثمر للمؤسسة النشطة.")}</DialogDescription>
          </DialogHeader>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="inv-code">{t("الكود")}</Label><Input id="inv-code" name="code" defaultValue={editing?.code} required /></div>
            <div className="space-y-2"><Label htmlFor="inv-name">{t("الاسم")}</Label><Input id="inv-name" name="fullName" defaultValue={editing?.fullName} required /></div>
            <div className="space-y-2"><Label htmlFor="inv-phone">{t("الهاتف")}</Label><Input id="inv-phone" name="phone" defaultValue={editing?.phone ?? ""} dir="ltr" /></div>
            <div className="space-y-2"><Label htmlFor="inv-nid">{t("الهوية")}</Label><Input id="inv-nid" name="nationalId" defaultValue={editing?.nationalId ?? ""} dir="ltr" /></div>
            <div className="space-y-2"><Label htmlFor="inv-email">{t("البريد")}</Label><Input id="inv-email" name="email" type="email" defaultValue={editing?.email ?? ""} dir="ltr" /></div>
            <div className="space-y-2">
              <Label htmlFor="inv-status">{t("الحالة")}</Label>
              <select id="inv-status" name="status" defaultValue={editing?.status ?? "active"}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                <option value="active">{t("نشط")}</option>
                <option value="inactive">{t("غير نشط")}</option>
              </select>
            </div>
          </div>
          <DialogFooter><SubmitBtn /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function InvestorsManager({ investors, canManage }: { investors: Investor[]; canManage: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Investor | null>(null);
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const sel = useSelection();

  const remove = (inv: Investor) => startTransition(async () => {
    const r = await deleteInvestorAction(inv.id);
    if (r.ok) toast.success("تم الحذف"); else toast.error(r.error ?? t("تعذّر الحذف"));
  });

  const q = query.trim().toLowerCase();
  const filtered = investors.filter((inv) =>
    (!statusFilter || inv.status === statusFilter) &&
    (!q || inv.code.toLowerCase().includes(q) || inv.fullName.toLowerCase().includes(q) || (inv.phone ?? "").includes(q) || (inv.email ?? "").toLowerCase().includes(q)),
  );
  const activeCount = investors.filter((i) => i.status === "active").length;
  const allIds = filtered.map((x) => x.id);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div><CardTitle>{t("قائمة المستثمرين")}</CardTitle><CardDescription>{investors.length} مستثمر · {activeCount} نشط</CardDescription></div>
        {canManage && <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="size-4" />{t("مستثمر جديد")}</Button>}
      </CardHeader>
      <CardContent>
        {investors.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("بحث بالكود أو الاسم أو الهاتف…")} className="max-w-xs" />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm">
              <option value="">{t("كل الحالات")}</option>
              <option value="active">{t("نشط")}</option>
              <option value="inactive">{t("غير نشط")}</option>
            </select>
            {(q || statusFilter) && <span className="text-sm text-muted-foreground">{filtered.length} نتيجة</span>}
          </div>
        )}
        {investors.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{t("لا يوجد مستثمرون بعد.")}</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{t("لا نتائج مطابقة.")}</div>
        ) : (
          <>
          {canManage && <BulkDeleteBar ids={sel.ids} action={bulkDeleteInvestorsAction} onDone={sel.clear} entity="مستثمر" />}
          <Table>
            <TableHeader>
              <TableRow>
                {canManage && <TableHead className="w-10"><SelectBox label={t("تحديد الكل")} checked={sel.allOf(allIds)} indeterminate={sel.someOf(allIds)} onChange={() => sel.togglePage(allIds)} /></TableHead>}
                <TableHead className="text-start">{t("الكود")}</TableHead>
                <TableHead className="text-start">{t("الاسم")}</TableHead>
                <TableHead className="text-start">{t("الهاتف")}</TableHead>
                <TableHead className="text-start">{t("الحالة")}</TableHead>
                {canManage && <TableHead className="text-start">{t("إجراءات")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((inv) => (
                <TableRow key={inv.id} data-state={sel.has(inv.id) ? "selected" : undefined}>
                  {canManage && <TableCell><SelectBox label={t("تحديد")} checked={sel.has(inv.id)} onChange={() => sel.toggle(inv.id)} /></TableCell>}
                  <TableCell className="font-mono">{inv.code}</TableCell>
                  <TableCell>{inv.fullName}</TableCell>
                  <TableCell dir="ltr" className="text-start">{inv.phone ?? "—"}</TableCell>
                  <TableCell><Badge variant={inv.status === "active" ? "default" : "secondary"}>{inv.status === "active" ? t("نشط") : t("غير نشط")}</Badge></TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => { setEditing(inv); setOpen(true); }} aria-label={t("تعديل")}><Pencil className="size-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild><Button variant="ghost" size="icon" disabled={pending} aria-label={t("حذف")}><Trash2 className="size-4 text-destructive" /></Button></AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader><AlertDialogTitle>حذف المستثمر «{inv.fullName}»؟</AlertDialogTitle><AlertDialogDescription>{t("لا يمكن التراجع.")}</AlertDialogDescription></AlertDialogHeader>
                            <AlertDialogFooter><AlertDialogCancel>{t("إلغاء")}</AlertDialogCancel><AlertDialogAction onClick={() => remove(inv)}>{t("حذف")}</AlertDialogAction></AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </>
        )}
      </CardContent>
      <InvestorDialog key={editing?.id ?? "new"} open={open} onOpenChange={setOpen} editing={editing} />
    </Card>
  );
}
