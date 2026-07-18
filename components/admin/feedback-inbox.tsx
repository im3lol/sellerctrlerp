"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Lightbulb, TriangleAlert } from "lucide-react";
import { replyFeedbackAction } from "@/app/actions/admin/feedback";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn, selectCls } from "@/lib/utils";

export type InboxItem = {
  id: string; kind: string; subject: string; message: string;
  status: string; reply: string | null;
  createdAt: string; orgName: string; userName: string | null;
};

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  open: { label: "جديدة", variant: "secondary" },
  seen: { label: "بنشتغل عليها", variant: "outline" },
  done: { label: "تم", variant: "default" },
};

const TABS = [
  { value: "open", label: "الجديدة" },
  { value: "seen", label: "بنشتغل عليها" },
  { value: "done", label: "المنتهية" },
  { value: "", label: "الكل" },
];


function ReplyDialog({ item, onClose }: { item: InboxItem; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reply, setReply] = useState(item.reply ?? "");
  const [status, setStatus] = useState(item.status);

  const save = () => start(async () => {
    const r = await replyFeedbackAction(item.id, { reply, status });
    if ("ok" in r) { toast.success("تم الحفظ"); router.refresh(); onClose(); }
    else toast.error(r.error);
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader><DialogTitle>{item.subject}</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg bg-muted p-3 text-sm">
            <div className="mb-1 text-xs text-muted-foreground">
              {item.orgName}{item.userName ? ` · ${item.userName}` : ""}
            </div>
            <p className="whitespace-pre-wrap">{item.message}</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="reply">الرد</Label>
            <Textarea id="reply" rows={5} value={reply} onChange={(e) => setReply(e.target.value)}
              placeholder="الرد ده بيظهر للعميل في صفحته." />
          </div>

          <div className="space-y-1">
            <Label htmlFor="status">الحالة</Label>
            <select id="status" className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">جديدة</option>
              <option value="seen">بنشتغل عليها</option>
              <option value="done">تم</option>
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />} حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FeedbackInbox({ items }: { items: InboxItem[] }) {
  const [tab, setTab] = useState("open");
  const [open, setOpen] = useState<InboxItem | null>(null);

  const shown = useMemo(() => (tab ? items.filter((i) => i.status === tab) : items), [items, tab]);
  const count = (s: string) => (s ? items.filter((i) => i.status === s).length : items.length);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.value} type="button" onClick={() => setTab(t.value)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              tab === t.value ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted",
            )}>
            {t.label} <span className="tabular-nums text-xs text-muted-foreground">{count(t.value)}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          مافيش حاجة هنا.
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {shown.map((i) => {
            const s = STATUS[i.status] ?? STATUS.open;
            return (
              <Card key={i.id} className="cursor-pointer transition-colors hover:bg-muted/50"
                onClick={() => setOpen(i)}>
                <CardContent className="space-y-2 pt-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {i.kind === "complaint"
                        ? <TriangleAlert className="size-4 shrink-0 text-amber-600" />
                        : <Lightbulb className="size-4 shrink-0 text-primary" />}
                      <span className="font-medium">{i.subject}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {i.reply && <Badge variant="outline">تم الرد</Badge>}
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </div>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{i.message}</p>
                  <div className="text-xs text-muted-foreground">
                    {i.orgName}{i.userName ? ` · ${i.userName}` : ""} · {i.createdAt}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {open && <ReplyDialog item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
