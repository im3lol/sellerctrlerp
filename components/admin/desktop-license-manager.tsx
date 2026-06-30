"use client";

import { useState, useTransition } from "react";
import { Copy, Check, Plus, ShieldOff, ShieldCheck, Monitor, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ALL_MODULES, MODULE_LABELS } from "@/lib/erp/module-list";
import {
  createDesktopLicenseAction,
  revokeDesktopLicenseAction,
  reinstateDesktopLicenseAction,
} from "@/app/actions/admin/desktop-licenses";

type License = {
  id: string;
  tokenHint: string;
  organizationId: string | null;
  orgName: string | null;
  enabledModules: string[];
  status: string;
  expiresAt: Date | null;
  lastHeartbeatAt: Date | null;
  notes: string | null;
  createdAt: Date;
};

type Org = { id: string; name: string | null };

/* ─── Create Dialog ──────────────────────────────────────────── */

function CreateDialog({ orgs, onClose }: { orgs: Org[]; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [createdToken, setCreatedToken] = useState<string>();
  const [copied, setCopied] = useState(false);

  const [orgId, setOrgId] = useState("");
  const [modules, setModules] = useState<string[]>([...ALL_MODULES]);
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");

  const allSelected = modules.length === ALL_MODULES.length;

  function handleSubmit() {
    setError(undefined);
    startTransition(async () => {
      const res = await createDesktopLicenseAction({
        organizationId: orgId || null,
        modules,
        expiresAt: expiresAt || null,
        notes,
      });
      if (res.error) { setError(res.error); return; }
      setCreatedToken(res.token!);
    });
  }

  function copyToken() {
    if (!createdToken) return;
    navigator.clipboard.writeText(createdToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (createdToken) {
    return (
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>تم إنشاء الترخيص</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            انسخ التوكن الآن — لن يظهر مجدّدًا. أرسله للعميل ليُدخله في شاشة التفعيل مع رابط هذا السيرفر.
          </p>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3 font-mono text-xs break-all">
            <span className="flex-1">{createdToken}</span>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={copyToken}>
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">يُدخل العميل في تطبيق سطح المكتب:</p>
            <p>رابط السيرفر: <code>https://your-domain.com</code></p>
            <p>التوكن: <code>{createdToken}</code></p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="max-w-lg" dir="rtl">
      <DialogHeader>
        <DialogTitle>ترخيص Desktop جديد</DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        {/* Org */}
        <div className="space-y-2">
          <Label>المؤسسة (اختياري)</Label>
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— بدون ربط بمؤسسة —</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name ?? o.id}</option>
            ))}
          </select>
        </div>

        <Separator />

        {/* Modules */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>الموديولات المفعّلة</Label>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setModules(allSelected ? [] : [...ALL_MODULES])}
            >
              {allSelected ? "إلغاء الكل" : "تحديد الكل"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {ALL_MODULES.map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
                <Checkbox
                  checked={modules.includes(m)}
                  onCheckedChange={(checked) =>
                    setModules((prev) => checked ? [...prev, m] : prev.filter((x) => x !== m))
                  }
                />
                {MODULE_LABELS[m] ?? m}
              </label>
            ))}
          </div>
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>تاريخ انتهاء الترخيص</Label>
            <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            <p className="text-xs text-muted-foreground">اتركه فارغًا للترخيص الدائم</p>
          </div>
          <div className="space-y-2">
            <Label>ملاحظات (اختياري)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اسم العميل أو التثبيت" />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button onClick={handleSubmit} disabled={pending || modules.length === 0}>
          {pending ? "جارٍ الإنشاء…" : "إنشاء الترخيص"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* ─── Main Component ─────────────────────────────────────────── */

export function DesktopLicenseManager({ licenses, orgs }: { licenses: License[]; orgs: Org[] }) {
  const [showCreate, setShowCreate] = useState(false);
  const [pending, startTransition] = useTransition();

  function fmt(d: Date | null) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-GB");
  }

  function heartbeatAge(d: Date | null): { label: string; ok: boolean } {
    if (!d) return { label: "لم يتصل بعد", ok: false };
    const hours = (Date.now() - new Date(d).getTime()) / 3_600_000;
    if (hours < 25) return { label: "خلال الـ 24 ساعة", ok: true };
    return { label: `منذ ${Math.floor(hours / 24)} يوم`, ok: false };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          كل ترخيص يُولَّد مرّة واحدة ويُخزَّن كـ HMAC فقط. التطبيق يجدّد الترخيص تلقائيًا كل 12 ساعة.
        </p>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="me-1.5 h-4 w-4" /> ترخيص جديد
        </Button>
      </div>

      {licenses.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
          <Monitor className="mx-auto mb-3 h-8 w-8 opacity-40" />
          <p className="text-sm">لا توجد تراخيص Desktop حتى الآن</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs text-muted-foreground">
              <tr className="[&>th]:p-3 [&>th]:text-start">
                <th>التوكن</th>
                <th>المؤسسة</th>
                <th>الحالة</th>
                <th>الموديولات</th>
                <th>الانتهاء</th>
                <th>آخر اتصال</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {licenses.map((lic) => {
                const hb = heartbeatAge(lic.lastHeartbeatAt);
                return (
                  <tr key={lic.id} className="border-t [&>td]:p-3 [&>td]:align-middle">
                    <td>
                      <span className="font-mono text-xs">{lic.tokenHint}</span>
                      {lic.notes && (
                        <div className="text-xs text-muted-foreground">{lic.notes}</div>
                      )}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {lic.orgName ?? "—"}
                    </td>
                    <td>
                      <Badge
                        variant={lic.status === "ACTIVE" ? "default" : "destructive"}
                        className="text-xs"
                      >
                        {lic.status === "ACTIVE" ? "نشط" : "ملغى"}
                      </Badge>
                    </td>
                    <td>
                      <span className="text-xs text-muted-foreground">
                        {lic.enabledModules.length} موديول
                      </span>
                    </td>
                    <td className="text-xs tabular-nums">{fmt(lic.expiresAt)}</td>
                    <td>
                      <div className="flex items-center gap-1.5 text-xs">
                        {hb.ok
                          ? <Wifi className="h-3.5 w-3.5 text-green-500" />
                          : <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span className={hb.ok ? "text-green-600" : "text-muted-foreground"}>
                          {hb.label}
                        </span>
                      </div>
                    </td>
                    <td>
                      {lic.status === "ACTIVE" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => { await revokeDesktopLicenseAction(lic.id); })
                          }
                        >
                          <ShieldOff className="me-1 h-3.5 w-3.5" /> إلغاء
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => { await reinstateDesktopLicenseAction(lic.id); })
                          }
                        >
                          <ShieldCheck className="me-1 h-3.5 w-3.5" /> إعادة تفعيل
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        {showCreate && <CreateDialog orgs={orgs} onClose={() => setShowCreate(false)} />}
      </Dialog>
    </div>
  );
}
