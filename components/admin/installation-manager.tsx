"use client";

import { useState, useTransition } from "react";
import { Copy, Check, Plus, ShieldOff, ShieldCheck, Server, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ALL_MODULES, MODULE_LABELS } from "@/lib/erp/module-list";
import {
  createInstallationAction,
  revokeInstallationAction,
  reinstateInstallationAction,
} from "@/app/actions/admin/installations";

type Installation = {
  id: string;
  licenseKey: string;
  customerName: string;
  status: string;
  enabledModules: string[];
  expiresAt: Date | null;
  gracePeriodDays: number;
  lastHeartbeatAt: Date | null;
  installId: string | null;
  notes: string | null;
  createdAt: Date;
};

/* ─── Create Dialog ──────────────────────────────────────────── */

function CreateDialog({ onClose }: { onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [createdKey, setCreatedKey] = useState<string>();
  const [copied, setCopied] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [modules, setModules] = useState<string[]>([...ALL_MODULES]);
  const [expiresAt, setExpiresAt] = useState("");
  const [gracePeriodDays, setGracePeriodDays] = useState(7);
  const [notes, setNotes] = useState("");

  const allSelected = modules.length === ALL_MODULES.length;

  function handleSubmit() {
    setError(undefined);
    startTransition(async () => {
      const res = await createInstallationAction({
        customerName, modules, expiresAt: expiresAt || null, gracePeriodDays, notes,
      });
      if (res.error) { setError(res.error); return; }
      setCreatedKey(res.licenseKey!);
    });
  }

  function copyKey() {
    if (!createdKey) return;
    navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (createdKey) {
    return (
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>تم إنشاء الترخيص</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            انسخ مفتاح الترخيص الآن — لن يظهر مجدّدًا. أضفه إلى ملف <code>.env</code> الخاص بالعميل.
          </p>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3 font-mono text-xs break-all">
            <span className="flex-1">{createdKey}</span>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={copyKey}>
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">متغيرات البيئة للعميل:</p>
            <p><code>INSTALL_LICENSE_KEY={createdKey}</code></p>
            <p><code>LICENSE_SERVER_URL=https://your-domain.com</code></p>
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
        <DialogTitle>ترخيص تثبيت جديد</DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        {/* Customer */}
        <div className="space-y-2">
          <Label>اسم العميل</Label>
          <Input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="شركة المثال"
          />
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

        {/* Expiry & grace */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>تاريخ انتهاء الترخيص</Label>
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">اتركه فارغًا للترخيص الدائم</p>
          </div>
          <div className="space-y-2">
            <Label>فترة السماح (أيام)</Label>
            <Input
              type="number"
              min={1}
              max={30}
              value={gracePeriodDays}
              onChange={(e) => setGracePeriodDays(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">مدة العمل بعد انقطاع الاتصال</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>ملاحظات (اختياري)</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="..." />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button onClick={handleSubmit} disabled={pending || !customerName}>
          {pending ? "جارٍ الإنشاء…" : "إنشاء الترخيص"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* ─── Main Component ─────────────────────────────────────────── */

export function InstallationManager({ installs }: { installs: Installation[] }) {
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
          ترخيص لكل تثبيت على سيرفر العميل. كل تثبيت يتصل بهذا الخادم كل 24 ساعة للتحقّق.
        </p>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="me-1.5 h-4 w-4" /> ترخيص جديد
        </Button>
      </div>

      {installs.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
          <Server className="mx-auto mb-3 h-8 w-8 opacity-40" />
          <p className="text-sm">لا توجد تثبيتات حتى الآن</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs text-muted-foreground">
              <tr className="[&>th]:p-3 [&>th]:text-start">
                <th>العميل</th>
                <th>الحالة</th>
                <th>الموديولات</th>
                <th>الانتهاء</th>
                <th>آخر اتصال</th>
                <th>Install ID</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {installs.map((inst) => {
                const hb = heartbeatAge(inst.lastHeartbeatAt);
                return (
                  <tr key={inst.id} className="border-t [&>td]:p-3 [&>td]:align-middle">
                    <td>
                      <div className="font-medium">{inst.customerName}</div>
                      {inst.notes && (
                        <div className="text-xs text-muted-foreground">{inst.notes}</div>
                      )}
                    </td>
                    <td>
                      <Badge
                        variant={inst.status === "ACTIVE" ? "default" : "destructive"}
                        className="text-xs"
                      >
                        {inst.status === "ACTIVE" ? "نشط" : inst.status === "REVOKED" ? "ملغى" : inst.status}
                      </Badge>
                    </td>
                    <td>
                      <span className="text-xs text-muted-foreground">
                        {inst.enabledModules.length} موديول
                      </span>
                    </td>
                    <td className="text-xs tabular-nums">{fmt(inst.expiresAt)}</td>
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
                      <span className="font-mono text-xs text-muted-foreground">
                        {inst.installId ? inst.installId.slice(0, 8) + "…" : "—"}
                      </span>
                    </td>
                    <td>
                      {inst.status === "ACTIVE" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => { await revokeInstallationAction(inst.id); })
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
                            startTransition(async () => { await reinstateInstallationAction(inst.id); })
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
        {showCreate && <CreateDialog onClose={() => setShowCreate(false)} />}
      </Dialog>
    </div>
  );
}
