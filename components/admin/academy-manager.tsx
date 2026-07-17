"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Pencil, Eye, EyeOff, ArrowRight } from "lucide-react";
import { saveLessonAction, toggleLessonAction, deleteLessonAction } from "@/app/actions/admin/academy";
import { ALL_MODULES, MODULE_LABELS, MODULE_ICONS } from "@/lib/erp/module-list";
// academy-core, not academy: that one imports the db and would drag `pg` into this bundle.
import { lessonFormat, FORMAT_LABELS } from "@/lib/erp/academy-core";
import { youtubeId } from "@/lib/erp/youtube";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type AdminLesson = {
  id: string; slug: string; title: string; module: string;
  outcome: string | null; url: string | null; body: string | null; minutes: number | null;
  level: string; sortOrder: number; isActive: boolean;
};

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

/** Ready = a video OR a doc. Mirrors isLive in lib/erp/academy.ts — the customer's rule. */
const live = (l: AdminLesson) => (!!l.url || !!l.body) && l.isActive;

/** A new lesson opens inside a module card, so it arrives pre-filed there and last in line. */
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
  const [body, setBody] = useState(lesson?.body ?? "");
  const [minutes, setMinutes] = useState(lesson?.minutes ? String(lesson.minutes) : "");
  const [level, setLevel] = useState(lesson?.level ?? "basic");
  const [sortOrder, setSortOrder] = useState(String(lesson?.sortOrder ?? preset?.sortOrder ?? 0));

  // Live feedback while typing: whether the link will actually play, and what the
  // customer ends up with. Both read the same rules the lesson page uses.
  const yt = youtubeId(url);
  const fmt = lessonFormat({ url: url.trim() || null, body: body.trim() || null });

  const save = () => start(async () => {
    const res = await saveLessonAction({
      slug, title, module, outcome, url, body,
      minutes: minutes ? Number(minutes) : null,
      level, sortOrder: Number(sortOrder || 0),
    }, lesson?.id);
    if ("ok" in res) { toast.success(isEdit ? "تم الحفظ" : "تمت إضافة الدرس"); router.refresh(); onClose(); }
    else toast.error(res.error);
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" dir="rtl">
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
            <Label htmlFor="url">رابط فيديو يوتيوب</Label>
            <Input id="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/…" dir="ltr" />
            {url.trim() ? (
              yt ? (
                <p className="text-xs text-emerald-600">✓ هيتشغّل جوّه النظام — الفيديو: {yt}</p>
              ) : (
                // Say it now, not after the customer opens a lesson that dumps them
                // on another site.
                <p className="text-xs text-amber-600">
                  مش رابط يوتيوب — الدرس هيبقى لينك بيفتح بره النظام بدل مشغّل الفيديو.
                </p>
              )
            ) : (
              <p className="text-xs text-muted-foreground">
                الصق أي شكل من روابط يوتيوب (watch / youtu.be / shorts) — هيتشغّل داخل الصفحة.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="body">الشرح المكتوب (Markdown)</Label>
            <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} rows={12}
              className="font-mono text-xs"
              placeholder={"## الخطوة الأولى\n\nافتح **المبيعات ← أوامر البيع** ودوس «أمر جديد».\n\n- اختار العميل\n- ضيف الأصناف\n\n> ملاحظة: الأمر بيفضل مسودة لحد ما تأكّده."} />
            <p className="text-xs text-muted-foreground">
              يدعم العناوين (##) والقوائم (-) والغامق (**) والجداول والروابط والصور.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
            <span className="font-medium">الصيغة: </span>
            {fmt === "both" ? "فيديو + مقال — الفيديو بيتشغّل فوق والمقال تحته في نفس الصفحة."
              : fmt === "video" ? "فيديو — حط شرح مكتوب كمان لو عايز الاتنين."
              : fmt === "doc" ? "مقال — حط رابط يوتيوب كمان لو عايز الاتنين."
              : "قريباً — لسه مافيش فيديو ولا مقال، فالدرس هيظهر «قريباً» ومش هيتفتح."}
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
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; lesson: AdminLesson | null; preset?: Preset }>({ open: false, lesson: null });
  const [confirmDel, setConfirmDel] = useState<AdminLesson | null>(null);

  // One card per module, sidebar order — the same index the customer sees at
  // /erp/academy, so what you arrange here is what they get.
  const cards = useMemo(
    () => ALL_MODULES.map((module) => {
      const mine = lessons.filter((l) => l.module === module);
      return {
        module,
        lessons: mine,
        total: mine.length,
        live: mine.filter(live).length,
        nextSort: mine.reduce((max, l) => Math.max(max, l.sortOrder), 0) + 1,
      };
    }),
    [lessons],
  );

  // A lesson whose module isn't in the list belongs to no card — without this it
  // vanishes from the admin while still sitting in the table.
  const orphans = useMemo(
    () => lessons.filter((l) => !(ALL_MODULES as readonly string[]).includes(l.module)),
    [lessons],
  );

  const liveTotal = lessons.filter(live).length;
  const current = cards.find((c) => c.module === open);

  const toggle = (id: string) => start(async () => {
    const r = await toggleLessonAction(id);
    if ("ok" in r) router.refresh(); else toast.error(r.error);
  });

  const remove = (l: AdminLesson) => start(async () => {
    const r = await deleteLessonAction(l.id);
    if ("ok" in r) { toast.success("تم الحذف"); router.refresh(); setConfirmDel(null); }
    else toast.error(r.error);
  });

  const dialogs = (
    <>
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
    </>
  );

  /* ── one module's lessons ── */
  if (current) {
    return (
      <div className="space-y-4" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
              <ArrowRight className="size-4" /> كل الموديولات
            </Button>
            <div className="flex items-center gap-2">
              <Icon name={MODULE_ICONS[current.module] ?? "GraduationCap"} className="size-[18px] text-muted-foreground" />
              <span className="font-semibold">{MODULE_LABELS[current.module]}</span>
              <span className="text-sm text-muted-foreground">
                {current.total} درس · {current.live} متاح
              </span>
            </div>
          </div>
          <Button size="sm"
            onClick={() => setDialog({ open: true, lesson: null, preset: { module: current.module, sortOrder: current.nextSort } })}>
            <Plus className="size-4" /> درس جديد
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">العنوان</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-right">الصيغة</TableHead>
                  <TableHead className="text-right">المدة</TableHead>
                  <TableHead className="text-right">الترتيب</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {current.lessons.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    لا توجد دروس في الموديول ده.
                  </TableCell></TableRow>
                )}
                {current.lessons.map((l) => (
                  <TableRow key={l.id} className={l.isActive ? "" : "opacity-50"}>
                    <TableCell>
                      <div className="font-medium">{l.title}</div>
                      <div className="text-xs text-muted-foreground" dir="ltr">{l.slug}</div>
                    </TableCell>
                    <TableCell>
                      {!l.isActive
                        ? <Badge variant="outline">مخفي</Badge>
                        : l.url || l.body
                          ? <Badge>متاح</Badge>
                          : <Badge variant="secondary">قريباً</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {l.url || l.body ? FORMAT_LABELS[lessonFormat(l)] : "—"}
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

        {dialogs}
      </div>
    );
  }

  /* ── the index ── */
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {lessons.length} درس · {liveTotal} متاح · {lessons.length - liveTotal} قريباً
        </span>
        <Button size="sm" onClick={() => setDialog({ open: true, lesson: null })}>
          <Plus className="size-4" /> درس جديد
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <button key={c.module} type="button" onClick={() => setOpen(c.module)}
            // Empty modules keep their card — an empty card is how the gap gets
            // noticed, and it's still clickable because that's where you'd add the
            // first lesson.
            className={cn(
              "rounded-xl border border-border p-5 text-right transition-colors hover:bg-muted",
              c.total === 0 && "border-dashed",
            )}>
            <div className="flex items-start justify-between">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Icon name={MODULE_ICONS[c.module] ?? "GraduationCap"} className="size-5" />
              </div>
              {c.total > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {c.total} درس
                </span>
              )}
            </div>
            <div className="mt-3 font-semibold">{MODULE_LABELS[c.module]}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {c.total === 0
                ? "لا توجد دروس — ابدأ من هنا"
                : `${c.live} متاح · ${c.total - c.live} قريباً`}
            </div>
          </button>
        ))}
      </div>

      {orphans.length > 0 && (
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

      {dialogs}
    </div>
  );
}
