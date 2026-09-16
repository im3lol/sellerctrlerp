"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveRuleAction, testRuleAction, type RuleTestResult } from "@/app/actions/erp/automation";
import {
  ACTION_LABEL, DOCS, EVENT_LABEL, OPS_FOR, OP_LABEL, PLACEHOLDERS, SECRET_KEPT, fieldsOf,
  type Action, type AutoEvent, type Condition, type Op, type RuleSpec,
} from "@/lib/erp/automation/model";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { selectCls } from "@/lib/utils";

type Member = { id: string; name: string; role: string };
type RoleOpt = { value: string; label: string };

const EMPTY: RuleSpec = {
  trigger: { kind: "event", entity: "SALES_ORDER", event: "CONFIRM" },
  match: "all",
  conditions: [],
  actions: [{ type: "notify", to: { creator: true }, message: "{doc} {number} {event} — {party}" }],
};

const NEW_ACTION: Record<Action["type"], Action> = {
  notify: { type: "notify", to: { creator: true }, message: "{doc} {number} {event}" },
  followUp: { type: "followUp", assignee: "creator", inDays: 1, summary: "تابع {doc} {number}" },
  comment: { type: "comment", body: "" },
  webhook: { type: "webhook", url: "" },
};

const toggleIn = (list: string[] | undefined, v: string) =>
  (list ?? []).includes(v) ? (list ?? []).filter((x) => x !== v) : [...(list ?? []), v];

/**
 * The rule builder: WHEN (document + event) → IF (field conditions) → DO (actions), with a
 * dry run on a real document before anything is saved or switched on.
 */
export function AutomationEditor({ rule, members, roles }: {
  rule: { id: string; name: string; enabled: boolean; spec: RuleSpec } | null;
  members: Member[];
  roles: RoleOpt[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(rule?.name ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [spec, setSpec] = useState<RuleSpec>(rule?.spec ?? EMPTY);
  const [testNo, setTestNo] = useState("");
  const [test, setTest] = useState<RuleTestResult | null>(null);

  const entity = spec.trigger.entity;
  const def = DOCS[entity];
  const fields = fieldsOf(entity);
  const typeOf = (key: string) => fields.find((f) => f.key === key)?.type ?? "text";

  const changeEntity = (e: string) => setSpec((s) => ({
    ...s,
    trigger: { ...s.trigger, entity: e },
    conditions: [], // fields differ per document
    actions: DOCS[e].chatter ? s.actions : s.actions.filter((a) => a.type === "notify" || a.type === "webhook"),
  }));
  const setCond = (i: number, patch: Partial<Condition>) =>
    setSpec((s) => ({ ...s, conditions: s.conditions.map((c, k) => (k === i ? { ...c, ...patch } : c)) }));
  const setAction = (i: number, a: Action) =>
    setSpec((s) => ({ ...s, actions: s.actions.map((x, k) => (k === i ? a : x)) }));
  const removeAction = (i: number) => setSpec((s) => ({ ...s, actions: s.actions.filter((_, k) => k !== i) }));

  const save = () => start(async () => {
    const r = await saveRuleAction({ id: rule?.id, name, enabled, spec });
    if (!r.ok) { toast.error(r.error ?? "تعذّر الحفظ"); return; }
    toast.success("اتحفظت");
    router.push("/automation");
    router.refresh();
  });

  const runTest = () => start(async () => setTest(await testRuleAction(spec, testNo)));

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="min-w-64 flex-1 space-y-2">
            <Label htmlFor="rule-name">اسم القاعدة</Label>
            <Input id="rule-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: تنبيه أوامر البيع الكبيرة" />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            {enabled ? "شغّالة" : "متوقفة"}
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">لما</CardTitle>
          <CardDescription>الحدث اللي يشغّل القاعدة.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label>المستند</Label>
            <select className={`${selectCls} w-52`} value={entity} onChange={(e) => changeEntity(e.target.value)}>
              {Object.entries(DOCS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>الحدث</Label>
            <select className={`${selectCls} w-52`} value={spec.trigger.event}
              onChange={(e) => setSpec((s) => ({ ...s, trigger: { ...s.trigger, event: e.target.value as AutoEvent } }))}>
              {(Object.keys(EVENT_LABEL) as AutoEvent[]).map((k) => <option key={k} value={k}>{EVENT_LABEL[k]}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">لو</CardTitle>
              <CardDescription>من غير شروط = كل {def?.label ?? "مستند"}.</CardDescription>
            </div>
            {spec.conditions.length > 1 && (
              <select className={`${selectCls} w-40`} value={spec.match}
                onChange={(e) => setSpec((s) => ({ ...s, match: e.target.value as "all" | "any" }))}>
                <option value="all">كل الشروط</option>
                <option value="any">أي شرط منهم</option>
              </select>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {spec.conditions.map((c, i) => {
            const type = typeOf(c.field);
            const noValue = c.op === "empty" || c.op === "notEmpty";
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select className={`${selectCls} w-44`} value={c.field}
                  onChange={(e) => {
                    const t = typeOf(e.target.value);
                    setCond(i, { field: e.target.value, op: OPS_FOR[t].includes(c.op) ? c.op : OPS_FOR[t][0] });
                  }}>
                  {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                <select className={`${selectCls} w-44`} value={c.op} onChange={(e) => setCond(i, { op: e.target.value as Op })}>
                  {OPS_FOR[type].map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
                </select>
                {!noValue && (
                  <Input className="w-48" dir={type === "text" ? undefined : "ltr"}
                    type={type === "number" ? "number" : type === "date" ? "date" : "text"}
                    value={c.value ?? ""} onChange={(e) => setCond(i, { value: e.target.value })} />
                )}
                <Button size="icon" variant="ghost" aria-label="شيل الشرط"
                  onClick={() => setSpec((s) => ({ ...s, conditions: s.conditions.filter((_, k) => k !== i) }))}>
                  <Icon name="X" className="size-4 text-destructive" />
                </Button>
              </div>
            );
          })}
          <Button size="sm" variant="outline" disabled={spec.conditions.length >= 10 || fields.length === 0}
            onClick={() => setSpec((s) => ({ ...s, conditions: [...s.conditions, { field: fields[0].key, op: OPS_FOR[fields[0].type][0], value: "" }] }))}>
            <Icon name="Plus" className="size-4" />شرط
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">اعمل</CardTitle>
          <CardDescription>
            في النصوص تقدر تستخدم: <span dir="ltr" className="font-mono text-xs">{PLACEHOLDERS.join(" ")}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {spec.actions.map((a, i) => (
            <div key={i} className="space-y-3 rounded-xl border p-3">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="secondary">{ACTION_LABEL[a.type]}</Badge>
                <Button size="icon" variant="ghost" aria-label="شيل الإجراء" onClick={() => removeAction(i)}>
                  <Icon name="X" className="size-4 text-destructive" />
                </Button>
              </div>

              {a.type === "notify" && (
                <>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="size-4" checked={!!a.to.creator}
                        onChange={(e) => setAction(i, { ...a, to: { ...a.to, creator: e.target.checked } })} />
                      صاحب المستند
                    </label>
                    {roles.map((r) => (
                      <label key={r.value} className="flex items-center gap-2">
                        <input type="checkbox" className="size-4" checked={(a.to.roles ?? []).includes(r.value)}
                          onChange={() => setAction(i, { ...a, to: { ...a.to, roles: toggleIn(a.to.roles, r.value) } })} />
                        كل «{r.label}»
                      </label>
                    ))}
                  </div>
                  {members.length > 0 && (
                    <div className="max-h-36 overflow-y-auto rounded-lg border p-2">
                      <div className="grid gap-1 text-sm sm:grid-cols-2">
                        {members.map((m) => (
                          <label key={m.id} className="flex items-center gap-2">
                            <input type="checkbox" className="size-4" checked={(a.to.users ?? []).includes(m.id)}
                              onChange={() => setAction(i, { ...a, to: { ...a.to, users: toggleIn(a.to.users, m.id) } })} />
                            {m.name} <span className="text-xs text-muted-foreground">({m.role})</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <Textarea rows={2} maxLength={1000} value={a.message} placeholder="نص التنبيه"
                    onChange={(e) => setAction(i, { ...a, message: e.target.value })} />
                  <p className="text-xs text-muted-foreground">بيوصل على تليجرام والإيميل لكل واحد رابط حسابه بيهم.</p>
                </>
              )}

              {a.type === "followUp" && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label>المسؤول</Label>
                    <select className={`${selectCls} w-52`} value={a.assignee} onChange={(e) => setAction(i, { ...a, assignee: e.target.value })}>
                      <option value="creator">صاحب المستند</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label>بعد (يوم)</Label>
                    <Input type="number" min={0} max={365} className="w-24" value={a.inDays}
                      onChange={(e) => setAction(i, { ...a, inDays: Math.max(0, Math.min(365, Math.trunc(Number(e.target.value) || 0))) })} />
                  </div>
                  <div className="min-w-64 flex-1 space-y-1">
                    <Label>المطلوب</Label>
                    <Input maxLength={500} value={a.summary} onChange={(e) => setAction(i, { ...a, summary: e.target.value })} />
                  </div>
                </div>
              )}

              {a.type === "comment" && (
                <Textarea rows={2} maxLength={2000} value={a.body} placeholder="التعليق اللي هيتكتب على المستند"
                  onChange={(e) => setAction(i, { ...a, body: e.target.value })} />
              )}

              {a.type === "webhook" && (() => {
                const kept = rule?.spec.actions[i]?.type === "webhook" && (rule.spec.actions[i] as { secret?: string }).secret === SECRET_KEPT;
                return (
                  <div className="space-y-2">
                    <Input dir="ltr" placeholder="https://hooks.zapier.com/…" value={a.url}
                      onChange={(e) => setAction(i, { ...a, url: e.target.value })} />
                    <div className="flex flex-wrap items-center gap-2">
                      <Input dir="ltr" type="password" autoComplete="new-password" className="max-w-xs"
                        value={a.secret === SECRET_KEPT ? "" : (a.secret ?? "")}
                        placeholder={a.secret === SECRET_KEPT ? "محفوظ — اكتب جديد لتغييره" : "مفتاح توقيع (اختياري)"}
                        onChange={(e) => setAction(i, { ...a, secret: e.target.value || (kept ? SECRET_KEPT : undefined) })} />
                      {a.secret === SECRET_KEPT && (
                        <Button size="sm" variant="ghost" onClick={() => setAction(i, { type: "webhook", url: a.url })}>شيل المفتاح</Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      بيتبعت POST فيه بيانات المستند. لو فيه مفتاح، الرسالة بتتوقّع في الهيدر
                      <span dir="ltr" className="mx-1 font-mono">x-sellerctrl-signature: sha256=…</span>
                    </p>
                  </div>
                );
              })()}
            </div>
          ))}

          <select className={`${selectCls} w-56`} value="" disabled={spec.actions.length >= 10}
            onChange={(e) => {
              const t = e.target.value as Action["type"];
              if (t) setSpec((s) => ({ ...s, actions: [...s.actions, structuredClone(NEW_ACTION[t])] }));
            }}>
            <option value="">+ ضيف إجراء…</option>
            {(Object.keys(ACTION_LABEL) as Action["type"][])
              .filter((t) => def?.chatter || (t !== "followUp" && t !== "comment"))
              .map((t) => <option key={t} value={t}>{ACTION_LABEL[t]}</option>)}
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">جرّب على مستند</CardTitle>
          <CardDescription>بيقولك القاعدة كانت هتعمل إيه على مستند حقيقي — من غير ما يبعت أو يكتب حاجة.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input dir="ltr" className="w-48" placeholder="SO-2026-0001" value={testNo} onChange={(e) => setTestNo(e.target.value)} />
            <Button variant="outline" disabled={pending || !testNo.trim()} onClick={runTest}>
              <Icon name="Play" className="size-4" />جرّب
            </Button>
          </div>
          {test && (test.ok ? (
            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <div className="font-medium">{test.matched ? "✅ الشروط اتحققت — هيتنفّذ:" : "⏸ الشروط ماتحققتش — مش هيحصل حاجة."}</div>
              {test.matched && <ul className="list-disc space-y-1 ps-5">{(test.lines ?? []).map((l, k) => <li key={k}>{l}</li>)}</ul>}
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">بيانات المستند</summary>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  {fields.map((f) => <div key={f.key}>{f.label}: <b>{String(test.facts?.[f.key] ?? "—")}</b></div>)}
                </div>
              </details>
            </div>
          ) : <p className="text-sm text-destructive">{test.error}</p>)}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button disabled={pending || !name.trim()} onClick={save}><Icon name="Check" className="size-4" />حفظ</Button>
        <Button variant="ghost" onClick={() => router.push("/automation")}>رجوع</Button>
      </div>
    </div>
  );
}
