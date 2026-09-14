"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { DocAuditCard, ACTION_AR } from "@/components/erp/document-detail";
import {
  getChatterAction, addCommentAction, addFollowUpAction, completeFollowUpAction, deleteCommentAction,
  type ChatterData,
} from "@/app/actions/erp/chatter";
import { followUpState, cairoToday, type ChatterKind, type FollowUpState } from "@/lib/erp/chatter";
import type { AuditRow } from "@/lib/erp/audit";
import { cn } from "@/lib/utils";

const when = (d: string | Date) =>
  new Date(d).toLocaleString("ar-EG-u-nu-latn", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const STATE: Record<FollowUpState, { label: string; cls: string }> = {
  overdue: { label: "متأخرة", cls: "bg-destructive/10 text-destructive" },
  today: { label: "النهارده", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  soon: { label: "جاية", cls: "bg-muted text-muted-foreground" },
  done: { label: "اتعملت", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
};

type Comment = ChatterData["comments"][number];
type FollowUp = ChatterData["followUps"][number];
type Entry =
  | { type: "comment"; key: string; at: string; c: Comment }
  | { type: "followUp"; key: string; at: string; f: FollowUp }
  | { type: "audit"; key: string; at: string; a: AuditRow };

/**
 * The conversation on one document, in one timeline: comments (with @mentions),
 * follow-ups (someone, by a date) and the audit trail. It loads itself through an action,
 * so a page adds it with one line — and falls back to the plain audit card when the member
 * may not talk here.
 */
export function DocChatter({ kind, entityId, entityNumber, audit }: {
  kind: ChatterKind; entityId: string; entityNumber: string; audit: AuditRow[];
}) {
  const [data, setData] = useState<ChatterData | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<"comment" | "followUp">("comment");
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState(() => cairoToday());
  const [pending, start] = useTransition();

  // First load: set state only after the await, and not at all once the page has moved on.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await getChatterAction(kind, entityId);
      if (!alive) return;
      if (r.ok && r.data) setData(r.data);
      else setFailed(true);
    })();
    return () => { alive = false; };
  }, [kind, entityId]);
  // After a post: reload what the server now holds.
  const load = async () => {
    const r = await getChatterAction(kind, entityId);
    if (r.ok && r.data) setData(r.data);
  };

  if (failed) return <DocAuditCard rows={audit} />;

  const today = cairoToday();
  const nameOf = (id: string | null) => (id && data?.members.find((m) => m.id === id)?.name) || "—";

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, done: string, reset?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.error) { toast.error(r.error); return; }
      toast.success(done);
      reset?.();
      await load();
    });

  const entries: Entry[] = [
    ...(data?.comments ?? []).map((c) => ({ type: "comment" as const, key: `c-${c.id}`, at: c.createdAt, c })),
    ...(data?.followUps ?? []).map((f) => ({ type: "followUp" as const, key: `f-${f.id}`, at: f.createdAt, f })),
    ...audit.map((a) => ({ type: "audit" as const, key: `a-${a.id}`, at: new Date(a.createdAt).toISOString(), a })),
  ].sort((x, y) => (x.at < y.at ? 1 : -1));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon name="MessagesSquare" className="size-4" />المحادثة والسجل</CardTitle>
        <CardDescription>علّق، اذكر زميل بـ«@»، أو سيب متابعة على حد بموعد — وكل اللي حصل على المستند في مكان واحد.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data ? (
          <div className="py-4 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-3 rounded-xl border p-3">
            <div className="flex gap-1">
              {(["comment", "followUp"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)}
                  className={cn("rounded-md px-3 py-1 text-sm", tab === t ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>
                  {t === "comment" ? "تعليق" : "متابعة"}
                </button>
              ))}
            </div>
            {tab === "comment" ? (
              <>
                <textarea
                  value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="اكتب تعليق…"
                  className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-52">
                    <CellCombobox
                      selectedLabel="" placeholder="@ اذكر زميل…"
                      options={data.members.filter((m) => m.id !== data.me && !mentions.includes(m.id)).map((m) => ({ id: m.id, label: m.name }))}
                      onSelect={(id, label) => {
                        setMentions((ms) => [...ms, id]);
                        setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@${label} `);
                      }}
                    />
                  </div>
                  {mentions.map((id) => (
                    <Badge key={id} variant="secondary" className="gap-1">
                      @{nameOf(id)}
                      <button type="button" aria-label="شيل" onClick={() => setMentions((ms) => ms.filter((x) => x !== id))}>
                        <Icon name="X" className="size-3" />
                      </button>
                    </Badge>
                  ))}
                  <Button size="sm" className="ms-auto" disabled={pending || !body.trim()}
                    onClick={() => run(() => addCommentAction({ kind, entityId, entityNumber, body, mentions }), "اتنشر", () => { setBody(""); setMentions([]); })}>
                    {pending && <Loader2 className="size-4 animate-spin" />}نشر
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <Input value={summary} onChange={(e) => setSummary(e.target.value)} className="min-w-60 flex-1"
                  placeholder="المطلوب — مثلاً: كلّم المورد على موعد الشحن" />
                <div className="w-44">
                  <CellCombobox
                    selectedLabel={assignee ? nameOf(assignee) : ""} placeholder="على مين؟"
                    options={data.members.map((m) => ({ id: m.id, label: m.id === data.me ? `${m.name} (أنا)` : m.name }))}
                    onSelect={(id) => setAssignee(id)}
                  />
                </div>
                <Input type="date" value={due} min={today} onChange={(e) => setDue(e.target.value)} className="w-40" />
                <Button size="sm" disabled={pending || summary.trim().length < 2 || !assignee}
                  onClick={() => run(() => addFollowUpAction({ kind, entityId, entityNumber, summary, assignedTo: assignee, dueDate: due }), "اتسجّلت المتابعة", () => { setSummary(""); setAssignee(""); })}>
                  {pending && <Loader2 className="size-4 animate-spin" />}سجّل
                </Button>
              </div>
            )}
          </div>
        )}

        {entries.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">لسه مفيش حاجة على المستند ده.</p>
        ) : (
          <ol className="space-y-3">
            {entries.map((e) => (
              <li key={e.key}>
                {e.type === "comment" ? (
                  <div className="flex gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {nameOf(e.c.userId).slice(0, 1)}
                    </span>
                    <div className="min-w-0 flex-1 rounded-xl bg-muted/40 px-3 py-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{nameOf(e.c.userId)}</span>
                        <span>{when(e.c.createdAt)}</span>
                        {e.c.userId === data?.me && (
                          <button type="button" className="ms-auto hover:text-destructive" disabled={pending}
                            onClick={() => run(() => deleteCommentAction(kind, e.c.id), "اتمسح")}>مسح</button>
                        )}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{e.c.body}</p>
                    </div>
                  </div>
                ) : e.type === "followUp" ? (
                  <FollowUpRow f={e.f} today={today} nameOf={nameOf} canClose={!!data && (e.f.assignedTo === data.me || e.f.createdBy === data.me)}
                    pending={pending} onDone={() => run(() => completeFollowUpAction(kind, e.f.id), "تمام ✓")} />
                ) : (
                  <div className="flex items-start gap-3 ps-11 text-xs text-muted-foreground">
                    <Badge variant="outline" className="shrink-0">{ACTION_AR[e.a.action] ?? e.a.action}</Badge>
                    <span className="min-w-0">{e.a.summary ?? "—"} · {when(e.a.createdAt)} · {e.a.userName ?? "تلقائي (النظام)"}</span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function FollowUpRow({ f, today, nameOf, canClose, pending, onDone }: {
  f: FollowUp; today: string; nameOf: (id: string | null) => string; canClose: boolean; pending: boolean; onDone: () => void;
}) {
  const st = followUpState(f.dueDate, f.doneAt, today);
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        <Icon name="Pin" className="size-4" />
      </span>
      <div className="min-w-0 flex-1 rounded-xl border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{f.summary}</span>
          <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", STATE[st].cls)}>{STATE[st].label}</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          على {nameOf(f.assignedTo)} · موعدها {f.dueDate} · طلبها {nameOf(f.createdBy)}
          {f.doneAt ? ` · اتعملت ${when(f.doneAt)} (${nameOf(f.doneBy)})` : ""}
        </div>
      </div>
      {!f.doneAt && canClose && (
        <Button size="sm" variant="outline" disabled={pending} onClick={onDone}>
          <Icon name="Check" className="size-4" />اتعملت
        </Button>
      )}
    </div>
  );
}
