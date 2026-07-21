"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Loader2, Upload, Pencil, PlugZap } from "lucide-react";
import { createPlatformAction, updatePlatformAction, togglePlatformActiveAction, provisionMarketplaceAction } from "@/app/actions/erp/platforms";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectCls } from "@/lib/utils";

type Platform = {
  id: string; name: string; code: string; integrationType: string; productSyncMode: string; isActive: boolean;
  syncProducts: boolean; syncOrders: boolean; syncInventory: boolean; syncSettlements: boolean; autoPostSettlements: boolean; autoMode: string;
  customerName: string | null; customerId: string | null;
  warehouseId: string | null; warehouseName: string | null;
  bankAccountId: string | null; bankName: string | null;
};
type Option = { id: string; nameAr: string };
type ConnectorInfo = { code: string; label: string };

const TYPE_LABEL: Record<string, string> = { amazon: "أمازون (محلّل مخصص)", generic: "عام (CSV بربط أعمدة)" };

// Brand tiles for the automatic picker. Monochrome logos in /public/logos —
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

function PlatformDialog({
  platform, warehouses, bankAccounts, connectors, onClose,
}: {
  platform: Platform | null; warehouses: Option[]; bankAccounts: Option[]; connectors: ConnectorInfo[]; onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isEdit = !!platform;
  const [mode, setMode] = useState<"choose" | "manual" | "auto">(isEdit ? "manual" : "choose");
  const [autoConnector, setAutoConnector] = useState<string | null>(null);
  const activeCodes = new Set(connectors.map((c) => c.code)); // connectors with an official integration
  const [name, setName] = useState(platform?.name ?? "");
  const [code, setCode] = useState(platform?.code ?? "");
  const [integrationType, setIntegrationType] = useState(platform?.integrationType ?? "generic");
  const [productSyncMode, setProductSyncMode] = useState(platform?.productSyncMode ?? "create");
  const [syncProducts, setSyncProducts] = useState(platform?.syncProducts ?? true);
  const [syncOrders, setSyncOrders] = useState(platform?.syncOrders ?? true);
  const [syncInventory, setSyncInventory] = useState(platform?.syncInventory ?? true);
  const [syncSettlements, setSyncSettlements] = useState(platform?.syncSettlements ?? true);
  const [autoPostSettlements, setAutoPostSettlements] = useState(platform?.autoPostSettlements ?? false);
  const [autoMode, setAutoMode] = useState(platform?.autoMode ?? "invoice");
  const [warehouseId, setWarehouseId] = useState(platform?.warehouseId ?? "");
  const [bankAccountId, setBankAccountId] = useState(platform?.bankAccountId ?? "");

  // Automatic setup: provision everything (platform + customer + FBA warehouse + Amazon Wallet bank).
  const provision = (fulfillment: string) => start(async () => {
    const r = await provisionMarketplaceAction({ connector: autoConnector!, fulfillment });
    if (r.ok) { toast.success("تم تجهيز أمازون: عميل + مخزن FBA + محفظة Amazon Wallet"); onClose(); router.push(`/platforms/${r.code ?? "amazon"}`); }
    else toast.error(r.error ?? "تعذّر التجهيز");
  });

  const save = () => {
    if (!name.trim()) return toast.error("أدخل اسم المنصة");
    if (!isEdit && !code.trim()) return toast.error("أدخل كود المنصة");
    start(async () => {
      const payload = { name, integrationType, productSyncMode, syncProducts, syncOrders, syncInventory, syncSettlements, autoPostSettlements, autoMode, defaultWarehouseId: warehouseId || null, bankAccountId: bankAccountId || null };
      const r = isEdit
        ? await updatePlatformAction(platform!.id, payload)
        : await createPlatformAction({ ...payload, code });
      if (r.ok) {
        toast.success(isEdit ? "تم تحديث المنصة" : "تم إنشاء المنصة وعميلها");
        onClose();
        router.refresh();
      } else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  const showForm = isEdit || mode === "manual";

  return (
    <DialogContent dir="rtl">
      <DialogHeader>
        <DialogTitle>{isEdit ? `تعديل ${platform!.name}` : mode === "auto" ? "ربط آلي" : mode === "manual" ? "منصة يدوية" : "منصة بيع جديدة"}</DialogTitle>
        <DialogDescription>
          {isEdit ? "الكود غير قابل للتعديل بعد الإنشاء."
            : mode === "choose" ? "اختر طريقة الإضافة."
            : mode === "auto" ? "اختر المنصة ونوع التنفيذ — يتم التجهيز تلقائيًا."
            : "سيُنشأ عميل تلقائيًا بنفس اسم المنصة وتُسجَّل مبيعاتها باسمه."}
        </DialogDescription>
      </DialogHeader>

      {!isEdit && mode === "choose" && (
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

      {showForm && (<>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label>اسم المنصة</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="أمازون" /></div>
          <div className="space-y-2">
            <Label>الكود</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="AMAZON" disabled={isEdit} className="font-mono" />
          </div>
        </div>
        <div className="space-y-2">
          <Label>نوع التكامل (شكل ملف الاستيراد)</Label>
          <select className={selectCls} value={integrationType} onChange={(e) => setIntegrationType(e.target.value)}>
            <option value="generic">{TYPE_LABEL.generic}</option>
            <option value="amazon">{TYPE_LABEL.amazon}</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label>مزامنة المنتجات (للمنصات المربوطة)</Label>
          <select className={selectCls} value={productSyncMode} onChange={(e) => setProductSyncMode(e.target.value)}>
            <option value="create">ربط بالـASIN + إنشاء الجديد (كامل)</option>
            <option value="link">ربط بالـASIN فقط (إثراء البيانات)</option>
          </select>
          <p className="text-xs text-muted-foreground">الربط يتم فقط لو الـASIN مضاف في أكواد الصنف عندك. «ربط فقط»: يكمّل بيانات المطابق ويتجاهل غير المطابق (يظهر «محتاج ASIN»). «ربط + إنشاء»: ينشئ صنفًا كاملًا لغير المطابق.</p>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>مصادر المزامنة</Label>
          <div className="flex flex-wrap gap-4">
            {([["المنتجات", syncProducts, setSyncProducts], ["المبيعات", syncOrders, setSyncOrders], ["المخزون", syncInventory, setSyncInventory], ["المدفوعات/التسويات", syncSettlements, setSyncSettlements]] as const).map(([label, val, setter]) => (
              <label key={label} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 rounded border-input" checked={val} onChange={(e) => setter(e.target.checked)} />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">اختر ما يسحبه زر «مزامنة الآن» لهذه المنصّة.</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">المعالجة التلقائية للأوردر</label>
          <select className={selectCls} value={autoMode} onChange={(e) => setAutoMode(e.target.value)}>
            <option value="invoice">أمر بيع + إذن صرف + فاتورة (الدورة كاملة)</option>
            <option value="deliver">أمر بيع + إذن صرف</option>
            <option value="order">أمر بيع فقط</option>
          </select>
          <p className="text-xs text-muted-foreground">تحدّد لأي مرحلة يمرّ الأوردر تلقائيًا. لو المخزون غير متوفر وقت الصرف، يُحفظ إذن الصرف كمسودة ويصلك إشعار «بانتظار توفّر المخزون» — بدون أي حركة سالبة.</p>
        </div>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="size-4 rounded border-input" checked={autoPostSettlements} onChange={(e) => setAutoPostSettlements(e.target.checked)} />
            الترحيل التلقائي للتسويات
          </label>
          <p className="text-xs text-muted-foreground">مفعّل: التسويات المسحوبة تُرحّل للقيود المحاسبية تلقائيًا. مُطفأ (الافتراضي): تُسحب وتنتظر مراجعتك ثم تضغط «ترحيل» يدويًا.</p>
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
        <Button onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>
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
  const [dialog, setDialog] = useState<{ open: boolean; platform: Platform | null }>({ open: false, platform: null });

  const toggle = (id: string) => start(async () => {
    const r = await togglePlatformActiveAction(id);
    if (r.ok) router.refresh(); else toast.error(r.error ?? "تعذّر التنفيذ");
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>المنصات</CardTitle>
            <CardDescription>كل منصة لها عميلها ومخزنها وحسابها البنكي، وتُستورد أوامرها إلى المبيعات.</CardDescription>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setDialog({ open: true, platform: null })}><Plus className="size-4" />منصة جديدة</Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {platforms.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
            لا توجد منصات — أضف منصتك الأولى (مثلًا أمازون).
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">المنصة</TableHead>
                <TableHead className="text-start">العميل</TableHead>
                <TableHead className="text-start">المخزن</TableHead>
                <TableHead className="text-start">البنك</TableHead>
                <TableHead className="text-start">الحالة</TableHead>
                <TableHead className="text-start">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {platforms.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/platforms/${p.code.toLowerCase()}`} className="font-medium text-primary hover:underline">{p.name}</Link>
                    <div className="text-xs text-muted-foreground"><span className="font-mono">{p.code}</span> · {TYPE_LABEL[p.integrationType] ?? p.integrationType}</div>
                  </TableCell>
                  <TableCell>{p.customerName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{p.warehouseName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{p.bankName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell><Badge variant={p.isActive ? "default" : "secondary"}>{p.isActive ? "مفعّلة" : "موقوفة"}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/platforms/${p.code.toLowerCase()}/import`}><Upload className="size-4" />استيراد</Link>
                      </Button>
                      {canManage && (
                        <>
                          <Button size="icon" variant="ghost" onClick={() => setDialog({ open: true, platform: p })} aria-label="تعديل"><Pencil className="size-4" /></Button>
                          <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggle(p.id)}>{p.isActive ? "إيقاف" : "تفعيل"}</Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog({ open: false, platform: null })}>
        {dialog.open && <PlatformDialog platform={dialog.platform} warehouses={warehouses} bankAccounts={bankAccounts} connectors={connectors} onClose={() => setDialog({ open: false, platform: null })} />}
      </Dialog>
    </Card>
  );
}
