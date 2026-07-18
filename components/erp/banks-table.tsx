"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Pencil, Trash2, FileText } from "lucide-react";
import { upsertBankAccountAction, toggleBankAccountActiveAction, deleteBankAccountAction, bulkDeleteBanksAction } from "@/app/actions/erp/bank-accounts";
import { useSelection, SelectBox, BulkDeleteBar } from "@/components/erp/bulk-select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectCls } from "@/lib/utils";

export type BankRow = {
  id: string; nameAr: string; bankName: string | null; accountNumber: string | null; iban: string | null;
  isActive: boolean; glAccountId: string | null; glCode: string | null; glName: string | null; balance: number;
};
type Account = { id: string; code: string; nameAr: string };

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function EditDialog({ row, accounts, onClose }: { row: BankRow; accounts: Account[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [nameAr, setNameAr] = useState(row.nameAr);
  const [bankName, setBankName] = useState(row.bankName ?? "");
  const [accountNumber, setAccountNumber] = useState(row.accountNumber ?? "");
  const [iban, setIban] = useState(row.iban ?? "");
  const [glAccountId, setGlAccountId] = useState(row.glAccountId ?? "");

  const save = () => {
    if (!nameAr.trim()) return toast.error("أدخل اسم الحساب");
    start(async () => {
      const r = await upsertBankAccountAction({ id: row.id, nameAr, bankName, accountNumber, iban, glAccountId: glAccountId || undefined });
      if (r.ok) { toast.success("تم تحديث الحساب البنكي"); onClose(); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <DialogContent dir="rtl">
      <DialogHeader>
        <DialogTitle>تعديل حساب بنكي</DialogTitle>
        <DialogDescription>اسم الحساب والبنك وربطه بحساب الأستاذ.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label>اسم الحساب</Label><Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} /></div>
          <div className="space-y-2"><Label>اسم البنك</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} /></div>
          <div className="space-y-2"><Label>رقم الحساب</Label><Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} /></div>
          <div className="space-y-2"><Label>IBAN</Label><Input value={iban} onChange={(e) => setIban(e.target.value)} className="font-mono" /></div>
        </div>
        <div className="space-y-2">
          <Label>حساب الأستاذ (GL)</Label>
          <select className={selectCls} value={glAccountId} onChange={(e) => setGlAccountId(e.target.value)}>
            <option value="">— بدون —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.nameAr}</option>)}
          </select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function BanksTable({ rows, accounts, canEdit }: { rows: BankRow[]; accounts: Account[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<BankRow | null>(null);
  const [confirmDel, setConfirmDel] = useState<BankRow | null>(null);
  const sel = useSelection();
  const ids = rows.map((r) => r.id);

  const toggle = (id: string) => start(async () => {
    const r = await toggleBankAccountActiveAction(id);
    if (r.ok) router.refresh(); else toast.error(r.error ?? "تعذّر التنفيذ");
  });
  const del = (row: BankRow) => start(async () => {
    const r = await deleteBankAccountAction(row.id);
    if (r.ok) { toast.success("تم حذف الحساب البنكي"); setConfirmDel(null); router.refresh(); }
    else { toast.error(r.error ?? "تعذّر الحذف"); setConfirmDel(null); }
  });

  return (
    <Card>
      <CardContent className="p-0">
        {canEdit && <div className="p-3 pb-0"><BulkDeleteBar ids={sel.ids} action={bulkDeleteBanksAction} onDone={sel.clear} entity="حساب بنكي" /></div>}
        <Table>
          <TableHeader>
            <TableRow>
              {canEdit && <TableHead className="w-10"><SelectBox checked={sel.allOf(ids)} indeterminate={sel.someOf(ids)} onChange={() => sel.togglePage(ids)} label="تحديد الكل" /></TableHead>}
              <TableHead className="text-start">الحساب</TableHead>
              <TableHead className="text-start">رقم الحساب / IBAN</TableHead>
              <TableHead className="text-start">حساب الأستاذ</TableHead>
              <TableHead className="text-start">رصيد الكشف</TableHead>
              <TableHead className="text-start">الحالة</TableHead>
              <TableHead className="text-start">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} data-state={canEdit && sel.has(r.id) ? "selected" : undefined}>
                {canEdit && <TableCell><SelectBox checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} label="تحديد" /></TableCell>}
                <TableCell>
                  <div className="font-medium">{r.nameAr}</div>
                  {r.bankName && <div className="text-xs text-muted-foreground">{r.bankName}</div>}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <div>{r.accountNumber || "—"}</div>
                  {r.iban && <div className="font-mono">{r.iban}</div>}
                </TableCell>
                <TableCell className="text-xs">{r.glCode ? `${r.glCode} — ${r.glName}` : <span className="text-muted-foreground">غير مربوط</span>}</TableCell>
                <TableCell className={`tabular-nums ${r.balance < 0 ? "text-destructive" : ""}`}>{fmt(r.balance)}</TableCell>
                <TableCell><Badge variant={r.isActive ? "default" : "outline"}>{r.isActive ? "نشط" : "غير نشط"}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button asChild size="sm" variant="outline"><Link href={`/erp/accounting/banks/${r.id}`}><FileText className="size-4" />الكشف</Link></Button>
                    {canEdit && (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => setEditing(r)} aria-label="تعديل"><Pencil className="size-4" /></Button>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggle(r.id)}>{r.isActive ? "إيقاف" : "تفعيل"}</Button>
                        <Button size="icon" variant="ghost" disabled={pending} onClick={() => setConfirmDel(r)} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <EditDialog row={editing} accounts={accounts} onClose={() => setEditing(null)} />}
      </Dialog>

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        {confirmDel && (
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>حذف الحساب البنكي</DialogTitle>
              <DialogDescription>
                سيتم حذف «{confirmDel.nameAr}» نهائيًا. إن كان مرتبطًا بحركات كشف أو منصات فسيُرفض الحذف ويُطلب منك إزالة الارتباط أولًا.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDel(null)}>إلغاء</Button>
              <Button variant="destructive" onClick={() => del(confirmDel)} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حذف</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
