"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Pencil, Eye, EyeOff } from "lucide-react";
import { saveLessonAction, toggleLessonAction, deleteLessonAction } from "@/app/actions/admin/academy";
import { ALL_MODULES, MODULE_LABELS, MODULE_ICONS } from "@/lib/erp/module-list";
import { Icon } from "@/components/icon";
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

/** A new lesson opens inside a module section, so it arrives pre-filed there and last in line. */
type Preset = { module: string; sortOrder: number };

function EditDialog({ lesson, preset, onClose }: { lesson: AdminLesson | null; preset?: Preset; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isEdit = !!lesson;

  const [slug, setSlug] = useState(lesson?.slug ?? "");
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [module, setModule] = useState(lesson?.module ?? preset?.module ?? "accounting");
  const [outcome, setOutcome] = useState(lesson?.outcome ?? "");
  const [url, setUrl] = useState(lesson?.url ?? "");
  const [minutes, setMinutes] = useState(lesson?.minutes ? String(lesson.minutes) : "");
  const [level, setLevel] = useState(lesson?.level ?? "basic");
  const [sortOrder, setSortOrder] = useState(String(lesson?.sortOrder ?? preset?.sortOrder ?? 0));

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
  const [dialog, setDialog] = useState<{ open: boolean; lesson: AdminLesson | null; preset?: Preset }>({ open: false, lesson: null });
  const [confirmDel, setConfirmDel] = useState<AdminLesson | null>(null);
  const [filter, setFilter] = useState("");

  // One section per module, same order as the sidebar and as /erp/academy. Empty
  // modules stay — the section with nothing in it is how the gap gets noticed.
  const sections = useMemo(
    () => ALL_MODULES.filter((m) => !filter || m === filter).map((module) => {
      const mine = lessons.filter((l) => l.module === module);
      return {
        module,
        lessons: mine,
        live: mine.filter((l) => l.url && l.isActive).length,
        nextSort: mine.reduce((max, l) => Math.max(max, l.sortOrder), 0) + 1,
      };
    }),
    [lessons, filter],
  );

  const orphans = useMemo(
    () => (filter ? [] : lessons.filter((l) => !(ALL_MODULES as readonly string[]).includes(l.module))),
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

      {sections.map((s) => (
        <Card key={s.module}>
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Icon name={MODULE_ICONS[s.module] ?? "GraduationCap"} className="size-[18px] text-muted-foreground" />
              <span className="font-semibold">{MODULE_LABELS[s.module]}</span>
              <span className="text-xs text-muted-foreground">
                {s.lessons.length === 0 ? "لا توجد دروس" : `${s.lessons.length} درس · ${s.live} متاح`}
              </span>
            </div>
            <Button variant="ghost" size="sm"
              onClick={() => setDialog({ open: true, lesson: null, preset: { module: s.module, sortOrder: s.nextSort } })}>
              <Plus className="size-4" /> أضف هنا
            </Button>
          </div>

          {s.lessons.length > 0 && (
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">العنوان</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right">المدة</TableHead>
                    <TableHead className="text-right">الترتيب</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.lessons.map((l) => (
                    <TableRow key={l.id} className={l.isActive ? "" : "opacity-50"}>
                      <TableCell>
                        <div className="font-medium">{l.title}</div>
                        <div className="text-xs text-muted-foreground" dir="ltr">{l.slug}</div>
                      </TableCell>
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
          )}
        </Card>
      ))}

      {orphans.length > 0 && (
        // A lesson whose module isn't in the list belongs to no section — without this
        // it would just disappear from the admin while still sitting in the table.
        <Card className="border-destructive/50">
          <div className="border-b px-4 py-3 text-sm font-semibold text-destructive">
            دروس بموديول غير معروف — عدّل الموديول عشان تظهر للعملاء
          </div>
          <CardContent className="p-0">
            <Table>
              <TableBody>
                {orphans.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <div className="font-medium">{l.title}</div>
                      <div className="text-xs text-muted-foreground" dir="ltr">{l.slug} · {l.module}</div>
                    </TableCell>
                    <TableCell className="w-28">
                      <Button variant="ghost" size="sm" onClick={() => setDialog({ open: true, lesson: l })}>
                        <Pencil className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {dialog.open && (
        <EditDialog lesson={dialog.lesson} preset={dialog.preset}
          onClose={() => setDialog({ open: false, lesson: null })} />
      )}

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
