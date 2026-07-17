"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Pencil, Eye, EyeOff } from "lucide-react";
import { saveLessonAction, toggleLessonAction, deleteLessonAction } from "@/app/actions/admin/academy";
import { ALL_MODULES, MODULE_LABELS } from "@/lib/erp/module-list";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type AdminLesson = {
  id: string; slug: string; title: string; module: string;
  outcome: string | null; url: string | null; minutes: number | null;
  level: string; sortOrder: number; isActive: boolean;
};

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

function EditDialog({ lesson, onClose }: { lesson: AdminLesson | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isEdit = !!lesson;

  const [slug, setSlug] = useState(lesson?.slug ?? "");
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [module, setModule] = useState(lesson?.module ?? "accounting");
  const [outcome, setOutcome] = useState(lesson?.outcome ?? "");
  const [url, setUrl] = useState(lesson?.url ?? "");
  const [minutes, setMinutes] = useState(lesson?.minutes ? String(lesson.minutes) : "");
  const [level, setLevel] = useState(lesson?.level ?? "basic");
  const [sortOrder, setSortOrder] = useState(String(lesson?.sortOrder ?? 0));

  const save = () => start(async () => {
    const res = await saveLessonAction({
      slug, title, module, outcome,
      url,
      minutes: minutes ? Number(minutes) : null,
      level, sortOrder: Number(sortOrder || 0),
    }, lesson?.id);
    if ("ok" in res) { toast.success(isEdit ? "تم الحفظ" : "تمت إضافة الدرس"); router.refresh(); onClose(); }
    else toast.error(res.error);
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader><DialogTitle>{isEdit ? "تعديل درس" : "درس جديد"}</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="title">العنوان *</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="دورة البيع كاملة" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="module">الموديول *</Label>
              <select id="module" className={selectCls} value={module} onChange={(e) => setModule(e.target.value)}>
                {ALL_MODULES.map((m) => <option key={m} value={m}>{MODULE_LABELS[m]}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="outcome">هيقدر يعمل إيه بعد الدرس؟</Label>
            <Input id="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}
              placeholder="تمشي أمر بيع من العرض للتسليم للفاتورة" />
            <p className="text-xs text-muted-foreground">ده اللي بيخلي المستخدم يعرف إن الدرس ده هيجاوب سؤاله — العنوان لوحده مابيكفيش.</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="url">رابط الفيديو</Label>
            <Input id="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/…" dir="ltr" />
            <p className="text-xs text-muted-foreground">سيبه فاضي = الدرس يظهر «قريباً» (مش قابل للضغط). املاه وهيشتغل فورًا.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="minutes">المدة (دقائق)</Label>
              <Input id="minutes" type="number" min="1" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="level">المستوى</Label>
              <select id="level" className={selectCls} value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="basic">أساسي</option>
                <option value="advanced">متقدّم</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sortOrder">الترتيب</Label>
              <Input id="sortOrder" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="slug">المعرّف (slug) *</Label>
            <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="sales-cycle" dir="ltr"
              disabled={isEdit} />
            <p className="text-xs text-muted-foreground">
              {isEdit ? "مش قابل للتعديل — الروابط المتشاركة معتمدة عليه." : "حروف إنجليزية صغيرة وأرقام وشرطات."}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button onClick={save} disabled={pending || !title || !slug}>
            {pending && <Loader2 className="size-4 animate-spin" />} حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AcademyManager({ lessons }: { lessons: AdminLesson[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<{ open: boolean; lesson: AdminLesson | null }>({ open: false, lesson: null });
  const [confirmDel, setConfirmDel] = useState<AdminLesson | null>(null);
  const [filter, setFilter] = useState("");

  const shown = useMemo(
    () => (filter ? lessons.filter((l) => l.module === filter) : lessons),
    [lessons, filter],
  );

  const live = lessons.filter((l) => l.url && l.isActive).length;

  const toggle = (id: string) => start(async () => {
    const r = await toggleLessonAction(id);
    if ("ok" in r) router.refresh(); else toast.error(r.error);
  });

  const remove = (l: AdminLesson) => start(async () => {
    const r = await deleteLessonAction(l.id);
    if ("ok" in r) { toast.success("تم الحذف"); router.refresh(); setConfirmDel(null); }
    else toast.error(r.error);
  });

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <select className={`${selectCls} w-48`} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">كل الموديولات</option>
            {ALL_MODULES.map((m) => <option key={m} value={m}>{MODULE_LABELS[m]}</option>)}
          </select>
          <span className="text-sm text-muted-foreground">
            {lessons.length} درس · {live} متاح · {lessons.length - live} قريباً
          </span>
        </div>
        <Button size="sm" onClick={() => setDialog({ open: true, lesson: null })}>
          <Plus className="size-4" /> درس جديد
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">العنوان</TableHead>
                <TableHead className="text-right">الموديول</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right">المدة</TableHead>
                <TableHead className="text-right">الترتيب</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">لا توجد دروس.</TableCell></TableRow>
              )}
              {shown.map((l) => (
                <TableRow key={l.id} className={l.isActive ? "" : "opacity-50"}>
                  <TableCell>
                    <div className="font-medium">{l.title}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">{l.slug}</div>
                  </TableCell>
                  <TableCell>{MODULE_LABELS[l.module] ?? l.module}</TableCell>
                  <TableCell>
                    {!l.isActive
                      ? <Badge variant="outline">مخفي</Badge>
                      : l.url
                        ? <Badge>متاح</Badge>
                        : <Badge variant="secondary">قريباً</Badge>}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{l.minutes ?? "—"}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{l.sortOrder}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => toggle(l.id)}
                        title={l.isActive ? "إخفاء" : "إظهار"}>
                        {l.isActive ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDialog({ open: true, lesson: l })}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDel(l)}>
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

      {dialog.open && <EditDialog lesson={dialog.lesson} onClose={() => setDialog({ open: false, lesson: null })} />}

      {confirmDel && (
        <Dialog open onOpenChange={() => setConfirmDel(null)}>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>حذف «{confirmDel.title}»؟</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              لو الدرس هيرجع تاني، «إخفاء» أفضل — بيحتفظ بالمعرّف فالروابط المتشاركة ماتكسرش.
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
