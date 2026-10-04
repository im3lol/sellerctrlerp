"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Trash2, Plus, Loader2 } from "lucide-react";
import { toast } from "@/lib/i18n/toast";
import { saveAccountAction, deleteAccountAction, initializeChartAction } from "@/app/actions/erp/accounts";
import type { ActionState } from "@/lib/erp/action-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Icon } from "@/components/icon";
import { cn, selectCls } from "@/lib/utils";

export type Account = {
  id: string; code: string; nameAr: string; nameEn: string | null;
  type: string; normalBalance: string; parentId: string | null; isLeaf: boolean; isActive: boolean;
};

const money = (n: number) => Math.abs(n).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Balance label: net = debit − credit → Dr if ≥0, Cr if <0. */
function Balance({ net }: { net: number }) {
  const t = useT();
  if (Math.abs(net) < 0.005) return <span className="text-muted-foreground tabular-nums">0.00</span>;
  const dr = net > 0;
  return (
    <span className={cn("tabular-nums font-medium", dr ? "text-foreground" : "text-foreground")}>
      {money(net)} <span className={cn("text-xs", dr ? "text-emerald-600" : "text-blue-600")}>{dr ? t("مدين") : t("دائن")}</span>
    </span>
  );
}

function SubmitBtn() {
  const t = useT();
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}{t("حفظ")}</Button>;
}

function AccountDialog({
  open, onOpenChange, editing, presetParent, accounts,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  editing: Account | null; presetParent: string | null; accounts: Account[];
}) {
  const t = useT();
  const [state, formAction] = useActionState<ActionState, FormData>(saveAccountAction, {});
  useEffect(() => {
    if (state.ok) { toast.success("تم الحفظ"); onOpenChange(false); }
    else if (state.error) toast.error(state.error);
  }, [state, onOpenChange]);

  const parentOptions = accounts.filter((a) => a.id !== editing?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form action={formAction} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? t("تعديل حساب") : t("حساب جديد")}</DialogTitle>
            <DialogDescription>{t("حساب ضمن دليل حسابات المؤسسة النشطة.")}</DialogDescription>
          </DialogHeader>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label htmlFor="a-code">{t("الكود")}</Label><Input id="a-code" name="code" defaultValue={editing?.code} required /></div>
            <div className="space-y-2"><Label htmlFor="a-name">{t("الاسم")}</Label><Input id="a-name" name="nameAr" defaultValue={editing?.nameAr} required /></div>
            <div className="space-y-2">
              <Label htmlFor="a-parent">{t("الحساب الأب")}</Label>
              <select id="a-parent" name="parentId" defaultValue={editing?.parentId ?? presetParent ?? ""} className={selectCls}>
                <option value="">{t("— حساب رئيسي —")}</option>
                {parentOptions.map((a) => <option key={a.id} value={a.id}>{a.code} — {t(a.nameAr)}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-type">{t("النوع")}</Label>
              <select id="a-type" name="type" defaultValue={editing?.type ?? "ASSET"} className={selectCls}>
                <option value="ASSET">{t("أصول")}</option>
                <option value="LIABILITY">{t("خصوم")}</option>
                <option value="EQUITY">{t("حقوق ملكية")}</option>
                <option value="REVENUE">{t("إيرادات")}</option>
                <option value="EXPENSE">{t("مصروفات")}</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-nb">{t("الطبيعة")}</Label>
              <select id="a-nb" name="normalBalance" defaultValue={editing?.normalBalance ?? "DEBIT"} className={selectCls}>
                <option value="DEBIT">{t("مدين")}</option>
                <option value="CREDIT">{t("دائن")}</option>
              </select>
            </div>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isLeaf" defaultChecked={editing ? editing.isLeaf : true} />{t("حساب تفصيلي (يقبل القيود)")}</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={editing ? editing.isActive : true} />{t("نشط")}</label>
          </div>
          <DialogFooter><SubmitBtn /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AccountsTree({
  accounts,
  balances,
  canManage,
}: {
  accounts: Account[];
  balances: Record<string, number>;
  canManage: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [presetParent, setPresetParent] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { roots, childrenOf } = useMemo(() => {
    const byParent = new Map<string, Account[]>();
    for (const a of accounts) {
      const key = a.parentId ?? "__root__";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(a);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    return { roots: byParent.get("__root__") ?? [], childrenOf: byParent };
  }, [accounts]);

  // Roll up balances: leaf = its own net; group = sum of descendants.
  const nodeBalance = useMemo(() => {
    const m = new Map<string, number>();
    const calc = (a: Account): number => {
      if (m.has(a.id)) return m.get(a.id)!;
      const kids = childrenOf.get(a.id) ?? [];
      let v = balances[a.id] ?? 0;
      for (const k of kids) v += calc(k);
      m.set(a.id, v);
      return v;
    };
    accounts.forEach(calc);
    return m;
  }, [accounts, childrenOf, balances]);

  // Collapsed by default — only root groups visible.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const expandAll = () => setExpanded(new Set(accounts.filter((a) => !a.isLeaf).map((a) => a.id)));
  const collapseAll = () => setExpanded(new Set());

  const openCreate = (parent: string | null) => { setEditing(null); setPresetParent(parent); setOpen(true); };
  const openEdit = (a: Account) => { setEditing(a); setPresetParent(null); setOpen(true); };
  const remove = (a: Account) => startTransition(async () => {
    const r = await deleteAccountAction(a.id);
    if (r.ok) toast.success("تم الحذف"); else toast.error(r.error ?? t("تعذّر الحذف"));
  });
  const initialize = () => startTransition(async () => {
    const r = await initializeChartAction();
    if (r.ok) toast.success("تم إنشاء دليل الحسابات القياسي"); else toast.error(r.error ?? t("تعذّرت التهيئة"));
  });

  const renderNode = (a: Account, depth: number): React.ReactNode => {
    const kids = childrenOf.get(a.id) ?? [];
    const hasKids = kids.length > 0;
    const isOpen = expanded.has(a.id);
    const net = nodeBalance.get(a.id) ?? 0;
    return (
      <div key={a.id}>
        <div className="group flex items-center gap-2 border-b py-2 pe-3 text-sm hover:bg-muted/40"
          style={{ paddingInlineStart: depth * 22 + 8 }}>
          {hasKids ? (
            <button onClick={() => toggle(a.id)} className="grid size-5 place-items-center rounded hover:bg-accent" aria-label={t("طيّ")}>
              <Icon name={isOpen ? "ChevronDown" : "ChevronLeft"} className="size-4" />
            </button>
          ) : (
            <span className="inline-block size-5" />
          )}
          <Icon name={hasKids ? "Folder" : "FileText"} className={cn("size-4 shrink-0", hasKids ? "text-primary" : "text-muted-foreground")} />
          <span className="font-mono text-muted-foreground">{a.code}</span>
          {a.isLeaf ? (
            <Link href={`/accounting/ledger?account=${a.id}`} className="hover:text-primary hover:underline" title={t("عرض دفتر الأستاذ")}>
              {t(a.nameAr)}
            </Link>
          ) : (
            <button onClick={() => toggle(a.id)} className="text-start font-semibold hover:underline">{t(a.nameAr)}</button>
          )}
          {!a.isActive && <Badge variant="secondary">{t("معطّل")}</Badge>}

          <div className="ms-auto flex items-center gap-2">
            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              {a.isLeaf && (
                <Button asChild variant="ghost" size="icon" className="size-7" aria-label={t("دفتر الأستاذ")}>
                  <Link href={`/accounting/ledger?account=${a.id}`}><Icon name="BookOpen" className="size-3.5" /></Link>
                </Button>
              )}
              {canManage && (
                <>
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => openCreate(a.id)} aria-label={t("حساب فرعي")}><Plus className="size-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(a)} aria-label={t("تعديل")}><Pencil className="size-3.5" /></Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="size-7" disabled={pending} aria-label={t("حذف")}><Trash2 className="size-3.5 text-destructive" /></Button></AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader><AlertDialogTitle>{t("حذف الحساب «")}{t(a.nameAr)}{t("»؟")}</AlertDialogTitle><AlertDialogDescription>{t("لا يمكن التراجع. تأكّد أنه بلا حسابات فرعية أو قيود.")}</AlertDialogDescription></AlertDialogHeader>
                      <AlertDialogFooter><AlertDialogCancel>{t("إلغاء")}</AlertDialogCancel><AlertDialogAction onClick={() => remove(a)}>{t("حذف")}</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
            <Balance net={net} />
          </div>
        </div>
        {hasKids && isOpen && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div><CardTitle>{t("دليل الحسابات")}</CardTitle><CardDescription>{t("اضغط على اسم الحساب لعرض دفتر أستاذه. الرصيد مجمّع من القيود المُرحّلة.")}</CardDescription></div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={expandAll}>{t("توسيع الكل")}</Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>{t("طيّ الكل")}</Button>
          {canManage && <Button onClick={() => openCreate(null)}><Plus className="size-4" />{t("حساب جديد")}</Button>}
        </div>
      </CardHeader>
      <CardContent>
        {roots.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-12 text-center text-muted-foreground">
            <p>{t("لا توجد حسابات بعد.")}</p>
            {canManage && (
              <Button onClick={initialize} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                {t("إنشاء دليل الحسابات القياسي")}
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-xl border">{roots.map((r) => renderNode(r, 0))}</div>
        )}
      </CardContent>
      <AccountDialog key={editing?.id ?? `new-${presetParent ?? "root"}`} open={open} onOpenChange={setOpen} editing={editing} presetParent={presetParent} accounts={accounts} />
    </Card>
  );
}
