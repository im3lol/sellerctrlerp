"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Pencil, Eye, EyeOff } from "lucide-react";
import { saveChangelogAction, toggleChangelogAction, deleteChangelogAction } from "@/app/actions/admin/changelog";
import { ALL_MODULES, MODULE_LABELS } from "@/lib/erp/module-list";
import { CHANGELOG_KINDS, KIND_LABELS } from "@/lib/erp/changelog-kinds";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectCls } from "@/lib/utils";

export type AdminEntry = {
  id: string; title: string; body: string; kind: string;
  module: string | null; releasedAt: string; isPublished: boolean;
};


function EditDialog({ entry, today, onClose }: { entry: AdminEntry | null; today: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isEdit = !!entry;

  const [title, setTitle] = useState(entry?.title ?? "");
  const [body, setBody] = useState(entry?.body ?? "");
  const [kind, setKind] = useState(entry?.kind ?? "feature");
  const [module, setModule] = useState(entry?.module ?? "");
  const [releasedAt, setReleasedAt] = useState(entry?.releasedAt ?? today);
  const [isPublished, setIsPublished] = useState(entry?.isPublished ?? true);

  const save = () => start(async () => {
    const res = await saveChangelogAction({ title, body, kind, module, releasedAt, isPublished }, entry?.id);
    if ("ok" in res) { toast.success(isEdit ? "تم الحفظ" : "تمت الإضافة"); router.refresh(); onClose(); }
    else toast.error(res.error);
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" dir="rtl">
        <DialogHeader><DialogTitle>{isEdit ? "تعديل تحديث" : "تحديث جديد"}</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="title">العنوان *</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="الأرصدة الافتتاحية: رحّل شركة قائمة في خطوة واحدة" />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="kind">النوع</Label>
              <select id="kind" className={selectCls} value={kind} onChange={(e) => setKind(e.target.value)}>
                {CHANGELOG_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="module">الموديول</Label>
              <select id="module" className={selectCls} value={module} onChange={(e) => setModule(e.target.value)}>
                <option value="">النظام كله</option>
                {ALL_MODULES.map((m) => <option key={m} value={m}>{MODULE_LABELS[m]}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="releasedAt">تاريخ النشر</Label>
              <Input id="releasedAt" type="date" value={releasedAt} onChange={(e) => setReleasedAt(e.target.value)} dir="ltr" />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="body">الشرح (Markdown) *</Label>
            <Textarea id="body" rows={10} value={body} onChange={(e) => setBody(e.target.value)}
              className="font-mono text-xs"
              placeholder={"دلوقتي تقدر ترحّل شركة شغّالة من نظامك القديم:\n\n- أرصدة العملاء والموردين\n- المخزون بتكلفته\n- أرصدة البنوك\n\nمن **الإعدادات ← الأرصدة الافتتاحية**."} />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)}
              className="size-4 rounded border-input" />
            منشور — يظهر للعملاء دلوقتي
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button onClick={save} disabled={pending || !title || !body}>
            {pending && <Loader2 className="size-4 animate-spin" />} حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ChangelogManager({ entries, today }: { entries: AdminEntry[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<{ open: boolean; entry: AdminEntry | null }>({ open: false, entry: null });
  const [confirmDel, setConfirmDel] = useState<AdminEntry | null>(null);

  const published = entries.filter((e) => e.isPublished).length;

  const toggle = (id: string) => start(async () => {
    const r = await toggleChangelogAction(id);
    if ("ok" in r) router.refresh(); else toast.error(r.error);
  });

  const remove = (e: AdminEntry) => start(async () => {
    const r = await deleteChangelogAction(e.id);
    if ("ok" in r) { toast.success("تم الحذف"); router.refresh(); setConfirmDel(null); }
    else toast.error(r.error);
  });

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {entries.length} تحديث · {published} منشور · {entries.length - published} مسودة
        </span>
        <Button size="sm" onClick={() => setDialog({ open: true, entry: null })}>
          <Plus className="size-4" /> تحديث جديد
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">العنوان</TableHead>
                <TableHead className="text-right">النوع</TableHead>
                <TableHead className="text-right">الموديول</TableHead>
                <TableHead className="text-right">التاريخ</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  لسه مافيش تحديثات.
                </TableCell></TableRow>
              )}
              {entries.map((e) => (
                <TableRow key={e.id} className={e.isPublished ? "" : "opacity-50"}>
                  <TableCell className="font-medium">{e.title}</TableCell>
                  <TableCell>{KIND_LABELS[e.kind] ?? e.kind}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.module ? MODULE_LABELS[e.module] ?? e.module : "النظام كله"}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground" dir="ltr">{e.releasedAt}</TableCell>
                  <TableCell>
                    {e.isPublished ? <Badge>منشور</Badge> : <Badge variant="outline">مسودة</Badge>}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => toggle(e.id)}
                        title={e.isPublished ? "إخفاء" : "نشر"}>
                        {e.isPublished ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDialog({ open: true, entry: e })}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDel(e)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {dialog.open && <EditDialog entry={dialog.entry} today={today} onClose={() => setDialog({ open: false, entry: null })} />}

      {confirmDel && (
        <Dialog open onOpenChange={() => setConfirmDel(null)}>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>حذف «{confirmDel.title}»؟</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              لو عايز تشيله من عين العملاء بس، «إخفاء» بيرجّعه مسودة من غير ما تفقده.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmDel(null)}>إلغاء</Button>
              <Button variant="destructive" disabled={pending} onClick={() => remove(confirmDel)}>حذف</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
