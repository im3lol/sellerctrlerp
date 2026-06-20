"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, FileText, Lightbulb, MonitorPlay, Plus, Trash2, Eye, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  createAcademyItemAction,
  deleteAcademyItemAction,
  recordAcademyViewAction,
  getAcademyViewersAction,
} from "@/app/actions/academy";
import { youtubeThumb, youtubeWatchUrl } from "@/lib/academy";

type Item = {
  id: string;
  type: "article" | "video" | "tip";
  title: string;
  body: string | null;
  youtubeUrl: string | null;
  category: string | null;
  viewCount: number;
  viewed: boolean;
};

const TABS = [
  { key: "article", label: "مقالات", Icon: FileText },
  { key: "video", label: "فيديوهات", Icon: MonitorPlay },
  { key: "tip", label: "نصائح", Icon: Lightbulb },
] as const;

export function AcademyView({ items, canManage }: { items: Item[]; canManage: boolean }) {
  const router = useRouter();
  const [reader, setReader] = useState<Item | null>(null);
  const [viewersOf, setViewersOf] = useState<Item | null>(null);

  const openItem = (item: Item) => {
    // Record the read/watch (first time counts), then open.
    recordAcademyViewAction(item.id).then(() => router.refresh());
    if (item.type === "video") {
      const url = youtubeWatchUrl(item.youtubeUrl);
      if (url) window.open(url, "_blank", "noopener");
    } else {
      setReader(item);
    }
  };

  return (
    <Tabs defaultValue="article" className="w-full">
      <div className="mb-4 flex items-center justify-between gap-3">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
              <t.Icon className="size-4" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {canManage && <AddItemDialog />}
      </div>

      {TABS.map((t) => {
        const list = items.filter((i) => i.type === t.key);
        return (
          <TabsContent key={t.key} value={t.key}>
            {list.length === 0 ? (
              <Card className="p-10 text-center text-sm text-muted-foreground">
                لا يوجد محتوى في هذا القسم بعد.
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    canManage={canManage}
                    onOpen={() => openItem(item)}
                    onViewers={() => setViewersOf(item)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        );
      })}

      {/* Article/tip reader */}
      <Dialog open={!!reader} onOpenChange={(o) => !o && setReader(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{reader?.title}</DialogTitle>
            {reader?.category && <DialogDescription>{reader.category}</DialogDescription>}
          </DialogHeader>
          <p className="whitespace-pre-wrap text-sm leading-7">{reader?.body}</p>
        </DialogContent>
      </Dialog>

      {/* Viewers (managers) */}
      <ViewersDialog item={viewersOf} onClose={() => setViewersOf(null)} />
    </Tabs>
  );
}

function ItemCard({
  item,
  canManage,
  onOpen,
  onViewers,
}: {
  item: Item;
  canManage: boolean;
  onOpen: () => void;
  onViewers: () => void;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const thumb = item.type === "video" ? youtubeThumb(item.youtubeUrl) : null;

  return (
    <Card className="flex flex-col overflow-hidden p-0">
      <button type="button" onClick={onOpen} className="group text-right">
        {item.type === "video" ? (
          <div className="relative aspect-video w-full bg-muted">
            {thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb} alt={item.title} loading="lazy" decoding="async" className="size-full object-cover" />
            )}
            <span className="absolute inset-0 grid place-items-center bg-black/25 transition group-hover:bg-black/35">
              <span className="grid size-14 place-items-center rounded-full bg-red-600 text-white shadow-lg">
                <Play className="size-6 translate-x-[1px]" fill="currentColor" />
              </span>
            </span>
          </div>
        ) : (
          <div className="grid aspect-video w-full place-items-center bg-primary/5">
            {item.type === "article" ? (
              <FileText className="size-10 text-primary/40" />
            ) : (
              <Lightbulb className="size-10 text-amber-500/60" />
            )}
          </div>
        )}
        <div className="p-4">
          <div className="mb-1 flex items-center gap-2">
            <p className="font-semibold leading-snug">{item.title}</p>
            {item.viewed && <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />}
          </div>
          {item.category && <Badge variant="outline" className="mb-1">{item.category}</Badge>}
          {item.body && item.type !== "video" && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{item.body}</p>
          )}
        </div>
      </button>

      {canManage && (
        <div className="mt-auto flex items-center justify-between border-t px-3 py-2">
          <button
            type="button"
            onClick={onViewers}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Eye className="size-4" />
            شاهدوه: {item.viewCount}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteAcademyItemAction(item.id);
                if (res.ok) {
                  toast.success("تم الحذف");
                  router.refresh();
                } else toast.error(res.error ?? "تعذّر الحذف");
              })
            }
            className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            title="حذف"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </button>
        </div>
      )}
    </Card>
  );
}

function ViewersDialog({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const [viewers, setViewers] = useState<{ name: string; at: string }[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!item) {
      setViewers(null);
      return;
    }
    setLoading(true);
    getAcademyViewersAction(item.id).then((res) => {
      setViewers(res.viewers ?? []);
      setLoading(false);
    });
  }, [item]);

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>من شاهد: {item?.title}</DialogTitle>
          <DialogDescription>قائمة من قرأ/شاهد هذا المحتوى</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="grid place-items-center py-8"><Loader2 className="size-5 animate-spin" /></div>
        ) : !viewers || viewers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">لم يشاهده أحد بعد.</p>
        ) : (
          <ul className="divide-y">
            {viewers.map((v, i) => (
              <li key={i} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium">{v.name}</span>
                <span className="text-xs text-muted-foreground">{new Date(v.at).toLocaleString("ar-EG-u-nu-latn")}</span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddItemDialog() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"article" | "video" | "tip">("article");
  const [state, formAction, pending] = useActionState(createAcademyItemAction, {});
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      toast.success("تمت الإضافة");
      setOpen(false);
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          إضافة محتوى
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة محتوى تعليمي</DialogTitle>
          <DialogDescription>مقال، فيديو يوتيوب، أو نصيحة</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {TABS.map((t) => (
              <label
                key={t.key}
                className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border p-2 text-sm ${
                  type === t.key ? "border-primary bg-primary/5 text-primary" : ""
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value={t.key}
                  checked={type === t.key}
                  onChange={() => setType(t.key)}
                  className="hidden"
                />
                <t.Icon className="size-4" />
                {t.label}
              </label>
            ))}
          </div>

          <Input name="title" placeholder="العنوان" required />
          <Input name="category" placeholder="التصنيف (اختياري) — مثلاً: أمازون، تصوير…" />

          {type === "video" ? (
            <Input name="youtubeUrl" dir="ltr" placeholder="https://www.youtube.com/watch?v=…" required />
          ) : (
            <Textarea name="body" rows={6} placeholder="المحتوى…" required />
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              نشر
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
