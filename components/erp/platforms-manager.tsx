"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2, Pencil, PlugZap, Settings, ExternalLink } from "lucide-react";
import { createPlatformAction, togglePlatformActiveAction, provisionMarketplaceAction } from "@/app/actions/erp/platforms";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectCls } from "@/lib/utils";

type Platform = {
  id: string; name: string; code: string; integrationType: string; isActive: boolean;
  customerName: string | null;
  warehouseName: string | null;
  bankName: string | null;
  connected: boolean; lastSyncAt: string | null;
};
type Option = { id: string; nameAr: string };
type ConnectorInfo = { code: string; label: string };

const TYPE_LABEL: Record<string, string> = { amazon: "أمازون (محلّل مخصص)", generic: "عام (CSV بربط أعمدة)" };

// Brand tiles + card logos. Monochrome logos in /public/brand/logos —
// swap those files to change the artwork; the box size normalizes any aspect ratio.
const BRANDS: { code: string; label: string; logo: string }[] = [
  { code: "AMAZON", label: "أمازون", logo: "/brand/logos/amazon.svg" },
  { code: "NOON", label: "نون", logo: "/brand/logos/noon.svg" },
  { code: "SHOPIFY", label: "شوبيفاي", logo: "/brand/logos/shopify.svg" },
];
const FULFILLMENTS: { code: string; label: string; hint: string; active: boolean }[] = [
  { code: "FBA", label: "FBA", hint: "أمازون يخزّن ويشحن", active: true },
  { code: "FBM", label: "FBM", hint: "أنت تشحن — قريبًا", active: false },
  { code: "FLEX", label: "Flex", hint: "قريبًا", active: false },
];
const tileCls = "flex items-center gap-3 rounded-xl border p-3 text-start transition-colors";

/** "منذ ٥ دقائق" style relative time (Arabic, coarse buckets). */
function ago(iso: string | null): string | null {
  if (!iso) return null;
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "منذ لحظات";
  if (s < 3600) return `منذ ${Math.round(s / 60)} دقيقة`;
  if (s < 86400) return `منذ ${Math.round(s / 3600)} ساعة`;
  return `منذ ${Math.round(s / 86400)} يوم`;
}

/** CREATE-only dialog (choose → ربط آلي / يدوي). Editing lives in /platforms/[code]/settings. */
function CreatePlatformDialog({
  warehouses, bankAccounts, connectors, onClose,
}: {
  warehouses: Option[]; bankAccounts: Option[]; connectors: ConnectorInfo[]; onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"choose" | "manual" | "auto">("choose");
  const [autoConnector, setAutoConnector] = useState<string | null>(null);
  const activeCodes = new Set(connectors.map((c) => c.code));
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [integrationType, setIntegrationType] = useState("generic");
  const [warehouseId, setWarehouseId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");

  // Automatic setup: provision everything (platform + customer + FBA warehouse + Amazon Wallet bank).
  const provision = (fulfillment: string) => start(async () => {
    const r = await provisionMarketplaceAction({ connector: autoConnector!, fulfillment });
    if (r.ok) { toast.success("تم تجهيز أمازون: عميل + مخزن FBA + محفظة Amazon Wallet"); onClose(); router.push(`/platforms/${r.code ?? "amazon"}`); }
    else toast.error(r.error ?? "تعذّر التجهيز");
  });

  const save = () => {
    if (!name.trim()) return toast.error("أدخل اسم المنصة");
    if (!code.trim()) return toast.error("أدخل كود المنصة");
    start(async () => {
      // بقية الإعدادات (مصادر المزامنة / المعالجة التلقائية…) قيمها الافتراضية سليمة —
      // تُضبط بعد الإنشاء من صفحة إعدادات المنصة.
      const r = await createPlatformAction({
        name, code, integrationType, productSyncMode: "create",
        syncProducts: true, syncOrders: true, syncInventory: true, syncSettlements: true,
        autoPostSettlements: false, autoMode: "invoice",
        defaultWarehouseId: warehouseId || null, bankAccountId: bankAccountId || null,
      });
      if (r.ok) { toast.success("تم إنشاء المنصة وعميلها"); onClose(); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <DialogContent dir="rtl">
      <DialogHeader>
        <DialogTitle>{mode === "auto" ? "ربط آلي" : mode === "manual" ? "منصة يدوية" : "منصة بيع جديدة"}</DialogTitle>
        <DialogDescription>
          {mode === "choose" ? "اختر طريقة الإضافة."
            : mode === "auto" ? "اختر المنصة ونوع التنفيذ — يتم التجهيز تلقائيًا."
            : "سيُنشأ عميل تلقائيًا بنفس اسم المنصة، وتُضبط بقية الإعدادات لاحقًا من صفحة الإعدادات."}
        </DialogDescription>
      </DialogHeader>

      {mode === "choose" && (
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setMode("auto")} className={`${tileCls} flex-col items-start gap-1.5 p-4 hover:border-primary`}>
            <PlugZap className="size-6 text-primary" />
            <span className="font-semibold">ربط آلي</span>
            <span className="text-xs text-muted-foreground">اختر منصة معروفة (أمازون) ويتم التجهيز تلقائيًا: عميل + مخزن + بنك.</span>
          </button>
          <button type="button" onClick={() => setMode("manual")} className={`${tileCls} flex-col items-start gap-1.5 p-4 hover:border-primary`}>
            <Pencil className="size-6 text-muted-foreground" />
            <span className="font-semibold">ربط يدوي</span>
            <span className="text-xs text-muted-foreground">تحدّد كل البيانات بنفسك (لأي منصة أو ملف CSV).</span>
          </button>
        </div>
      )}

      {mode === "auto" && !autoConnector && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {BRANDS.map((b) => {
              const on = activeCodes.has(b.code);
              return (
                <button key={b.code} type="button" disabled={!on} onClick={() => on && setAutoConnector(b.code)} className={`relative flex items-center justify-center rounded-xl border p-4 transition-colors ${on ? "hover:border-primary" : "cursor-not-allowed opacity-50"}`}>
                  {/* Fixed box + object-contain → every logo occupies the same width AND height regardless of its native aspect ratio. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.logo} alt={b.label} className="h-8 w-28 object-contain dark:invert" />
                  {!on && <Badge variant="secondary" className="absolute start-1.5 top-1.5">قريبًا</Badge>}
                </button>
              );
            })}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setMode("choose")}>رجوع</Button>
        </div>
      )}

      {mode === "auto" && autoConnector && (
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">نوع التنفيذ لأمازون:</div>
          <div className="grid gap-2">
            {FULFILLMENTS.map((f) => (
              <button key={f.code} type="button" disabled={!f.active || pending} onClick={() => f.active && provision(f.code)} className={`${tileCls} ${f.active ? "hover:border-primary" : "cursor-not-allowed opacity-50"}`}>
                <span className="font-mono text-base font-bold">{f.label}</span>
                <span className="flex-1 text-sm text-muted-foreground">{f.hint}</span>
                {!f.active && <Badge variant="secondary">قريبًا</Badge>}
                {f.active && pending && <Loader2 className="size-4 animate-spin" />}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">سيُنشأ: منصة أمازون + عميل + مخزن «أمازون FBA» + بنك «Amazon Wallet» — كلها قابلة للتعديل لاحقًا.</p>
          <Button variant="ghost" size="sm" onClick={() => setAutoConnector(null)}>رجوع</Button>
        </div>
      )}

      {mode === "manual" && (<>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>اسم المنصة</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="أمازون" /></div>
            <div className="space-y-2">
              <Label>الكود</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="AMAZON" className="font-mono" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>نوع التكامل (شكل ملف الاستيراد)</Label>
            <select className={selectCls} value={integrationType} onChange={(e) => setIntegrationType(e.target.value)}>
              <option value="generic">{TYPE_LABEL.generic}</option>
              <option value="amazon">{TYPE_LABEL.amazon}</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>المخزن الافتراضي</Label>
              <select className={selectCls} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">— بدون —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>الحساب البنكي للتسويات</Label>
              <select className={selectCls} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                <option value="">— بدون —</option>
                {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
              </select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}إنشاء</Button>
        </DialogFooter>
      </>)}
    </DialogContent>
  );
}

export function PlatformsManager({
  platforms, warehouses, bankAccounts, canManage, connectors,
}: {
  platforms: Platform[]; warehouses: Option[]; bankAccounts: Option[]; canManage: boolean; connectors: ConnectorInfo[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);

  const toggle = (id: string) => start(async () => {
    const r = await togglePlatformActiveAction(id);
    if (r.ok) router.refresh(); else toast.error(r.error ?? "تعذّر التنفيذ");
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">كل منصة لها عميلها ومخزنها وحسابها البنكي، وتُستورد أوامرها إلى المبيعات.</p>
        {canManage && (
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" />منصة جديدة</Button>
        )}
      </div>

      {platforms.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
          لا توجد منصات — أضف منصتك الأولى (مثلًا أمازون).
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {platforms.map((p) => {
            const brand = BRANDS.find((b) => b.code === p.code.toUpperCase());
            const last = ago(p.lastSyncAt);
            const detail = `/platforms/${p.code.toLowerCase()}`;
            return (
              <Card key={p.id} className={p.isActive ? "" : "opacity-70"}>
                <CardContent className="space-y-4 pt-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl border bg-muted/30">
                        {brand ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={brand.logo} alt={p.name} className="h-6 w-10 object-contain dark:invert" />
                        ) : (
                          <span className="text-lg font-bold text-muted-foreground">{p.name.charAt(0)}</span>
                        )}
                      </div>
                      <div>
                        <Link href={detail} className="font-semibold hover:text-primary">{p.name}</Link>
                        <div className="text-xs text-muted-foreground"><span className="font-mono">{p.code}</span> · {TYPE_LABEL[p.integrationType] ?? p.integrationType}</div>
                      </div>
                    </div>
                    {!p.isActive ? <Badge variant="secondary">موقوفة</Badge>
                      : p.connected ? <Badge className="bg-emerald-600">مربوط ✓</Badge>
                      : <Badge variant="outline">غير مربوط</Badge>}
                  </div>

                  <div className="space-y-1 text-sm text-muted-foreground">
                    <div>المخزن: <span className="text-foreground">{p.warehouseName ?? "—"}</span></div>
                    <div>العميل: <span className="text-foreground">{p.customerName ?? "—"}</span></div>
                    <div>آخر مزامنة: <span className="text-foreground">{last ?? "لم تتم بعد"}</span></div>
                  </div>

                  <div className="flex gap-2 border-t pt-3">
                    <Button asChild size="sm" className="flex-1">
                      <Link href={detail}><ExternalLink className="size-4" />فتح</Link>
                    </Button>
                    {canManage && (
                      <>
                        <Button asChild size="sm" variant="outline">
                          <Link href={`${detail}/settings`}><Settings className="size-4" />إعدادات</Link>
                        </Button>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggle(p.id)}>
                          {p.isActive ? "إيقاف" : "تفعيل"}
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        {open && <CreatePlatformDialog warehouses={warehouses} bankAccounts={bankAccounts} connectors={connectors} onClose={() => setOpen(false)} />}
      </Dialog>
    </div>
  );
}
