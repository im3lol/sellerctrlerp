"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, FileText, CheckCircle2, Truck, ReceiptText } from "lucide-react";
import { updatePlatformAction } from "@/app/actions/erp/platforms";
import { setAutoSyncAction } from "@/app/actions/erp/marketplace-connect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ComboboxBase, type ComboOption } from "@/components/erp/combobox-base";
import { selectCls } from "@/lib/utils";

type Platform = {
  id: string; name: string; code: string; integrationType: string; productSyncMode: string;
  syncProducts: boolean; syncOrders: boolean; syncInventory: boolean; syncSettlements: boolean; syncReturns: boolean;
  autoPostSettlements: boolean; autoMode: string;
  warehouseId: string | null; bankAccountId: string | null; customerName: string | null;
};
type Option = { id: string; nameAr: string };

// The automation ladder — each tier includes everything before it.
const AUTO_MODES = [
  { value: "draft", icon: FileText, title: "مسودة فقط", desc: "الطلب يدخل النظام كمسودة بدون تأكيد — أنت تراجع وتؤكّد كل طلب يدويًا." },
  { value: "order", icon: CheckCircle2, title: "أمر بيع مؤكّد", desc: "الطلب المشحون يُؤكَّد تلقائيًا — إذن الصرف والفاتورة عليك." },
  { value: "deliver", icon: Truck, title: "تأكيد + إذن صرف", desc: "بعد التأكيد يُنشأ إذن الصرف ويُرحَّل (خصم المخزون وتكلفة البضاعة)." },
  { value: "invoice", icon: ReceiptText, title: "الدورة كاملة حتى الفاتورة", desc: "تأكيد + صرف + فاتورة مُرحّلة (إيراد وذمم) — الوضع الافتراضي." },
] as const;

const SOURCES = [
  { key: "products", label: "المنتجات", desc: "سحب الكتالوج وربطه بالأصناف (حسب وضع المزامنة بالأسفل)." },
  { key: "orders", label: "المبيعات", desc: "الطلبات الجديدة أولًا بأول — وتدخل الدورة حسب «المعالجة التلقائية»." },
  { key: "inventory", label: "المخزون", desc: "قراءة كميات FBA للمقارنة في تدقيق المخزون (لا يغيّر أرصدتك)." },
  { key: "settlements", label: "المدفوعات والتسويات", desc: "تقارير التسويات (المبالغ والرسوم والتحويلات البنكية)." },
  { key: "returns", label: "المرتجعات", desc: "مرتجعات FBA تُسحب تلقائيًا وتُنشأ كمرتجع فاتورة مسودة للمراجعة." },
] as const;

export function PlatformSettingsForm({
  platform, warehouses, bankAccounts, autoSync: initialAutoSync, connected,
}: {
  platform: Platform; warehouses: Option[]; bankAccounts: Option[];
  autoSync: boolean; connected: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [autoSync, setAutoSync] = useState(initialAutoSync);
  const [autoSyncPending, startAutoSync] = useTransition();

  // Auto-sync is a credentials-level toggle (near-real-time scheduler), saved on
  // flip — independent of the «حفظ الإعدادات» button below.
  const toggleAutoSync = (next: boolean) => {
    setAutoSync(next);
    startAutoSync(async () => {
      const r = await setAutoSyncAction(platform.code.toLowerCase(), next);
      if (r.ok) toast.success(next ? "تم تفعيل المزامنة التلقائية" : "تم إيقاف المزامنة التلقائية");
      else { setAutoSync(!next); toast.error(r.error); }
    });
  };
  const [name, setName] = useState(platform.name);
  const [integrationType, setIntegrationType] = useState(platform.integrationType);
  const [productSyncMode, setProductSyncMode] = useState(platform.productSyncMode);
  const [sources, setSources] = useState({
    products: platform.syncProducts, orders: platform.syncOrders,
    inventory: platform.syncInventory, settlements: platform.syncSettlements,
    returns: platform.syncReturns,
  });
  const [autoMode, setAutoMode] = useState(platform.autoMode || "invoice");
  const [autoPostSettlements, setAutoPostSettlements] = useState(platform.autoPostSettlements);
  const [warehouseId, setWarehouseId] = useState(platform.warehouseId ?? "");
  const [bankAccountId, setBankAccountId] = useState(platform.bankAccountId ?? "");

  const whOptions: ComboOption[] = warehouses.map((w) => ({ id: w.id, label: w.nameAr }));
  const bankOptions: ComboOption[] = bankAccounts.map((b) => ({ id: b.id, label: b.nameAr }));

  const save = () => {
    if (!name.trim()) return toast.error("أدخل اسم المنصة");
    start(async () => {
      const r = await updatePlatformAction(platform.id, {
        name, integrationType, productSyncMode,
        syncProducts: sources.products, syncOrders: sources.orders,
        syncInventory: sources.inventory, syncSettlements: sources.settlements,
        syncReturns: sources.returns,
        autoPostSettlements, autoMode,
        defaultWarehouseId: warehouseId || null, bankAccountId: bankAccountId || null,
      });
      if (r.ok) { toast.success("تم حفظ إعدادات المنصة"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* المزامنة التلقائية — connected platforms only */}
      {connected && (
        <Card>
          <CardHeader>
            <CardTitle>المزامنة التلقائية</CardTitle>
            <CardDescription>الطلبات الجديدة تدخل النظام تلقائيًا خلال دقائق (وإشعار في الجرس)، والمنتجات الجديدة تُكتشف يوميًا.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
              <div className="text-sm font-medium">تفعيل المزامنة التلقائية المجدولة</div>
              <Switch checked={autoSync} onCheckedChange={toggleAutoSync} disabled={autoSyncPending} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ١ — الهوية */}
      <Card>
        <CardHeader>
          <CardTitle>الهوية</CardTitle>
          <CardDescription>اسم المنصة وكودها ونوع ملف الاستيراد اليدوي.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="pname">اسم المنصة</Label>
            <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>الكود</Label>
            <Input value={platform.code} disabled className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ptype">نوع التكامل</Label>
            <select id="ptype" className={selectCls} value={integrationType} onChange={(e) => setIntegrationType(e.target.value)}>
              <option value="generic">عام (CSV بربط أعمدة)</option>
              <option value="amazon">أمازون (محلّل مخصص)</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* ٢ — مصادر المزامنة */}
      <Card>
        <CardHeader>
          <CardTitle>مصادر المزامنة</CardTitle>
          <CardDescription>ما يسحبه زر «مزامنة الآن» والمزامنة التلقائية لهذه المنصة.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {SOURCES.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-4 rounded-lg px-2 py-2.5 hover:bg-muted/40">
              <div>
                <div className="text-sm font-medium">{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.desc}</div>
              </div>
              <Switch checked={sources[s.key]} onCheckedChange={(v) => setSources((p) => ({ ...p, [s.key]: v }))} />
            </div>
          ))}
          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="psync">وضع مزامنة المنتجات</Label>
            <select id="psync" className={selectCls} value={productSyncMode} onChange={(e) => setProductSyncMode(e.target.value)}>
              <option value="create">ربط بالـASIN + إنشاء الجديد (كامل)</option>
              <option value="link">ربط بالـASIN فقط (إثراء البيانات)</option>
            </select>
            <p className="text-xs text-muted-foreground">الربط يتم فقط لو الـASIN مضاف في أكواد الصنف عندك. «ربط فقط»: يكمّل بيانات المطابق ويتجاهل غير المطابق. «ربط + إنشاء»: ينشئ صنفًا كاملًا لغير المطابق.</p>
          </div>
        </CardContent>
      </Card>

      {/* ٣ — المعالجة التلقائية */}
      <Card>
        <CardHeader>
          <CardTitle>المعالجة التلقائية للأوردر</CardTitle>
          <CardDescription>لأي مرحلة يمرّ الطلب المتزامن تلقائيًا — كل مستوى يشمل ما قبله.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            {AUTO_MODES.map((m) => {
              const on = autoMode === m.value;
              return (
                <button key={m.value} type="button" onClick={() => setAutoMode(m.value)}
                  className={`flex items-start gap-3 rounded-xl border p-3 text-start transition-colors ${on ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/50"}`}>
                  <m.icon className={`mt-0.5 size-5 shrink-0 ${on ? "text-primary" : "text-muted-foreground"}`} />
                  <span>
                    <span className="block text-sm font-semibold">{m.title}</span>
                    <span className="block text-xs text-muted-foreground">{m.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">لو المخزون غير متوفر وقت الصرف، يُحفظ إذن الصرف كمسودة ويصلك إشعار «بانتظار توفّر المخزون» — بدون أي حركة سالبة، ويُستكمل تلقائيًا أول ما المخزون يتوفر.</p>
          <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">الترحيل التلقائي للتسويات</div>
              <div className="text-xs text-muted-foreground">مفعّل: التسويات المسحوبة تُرحّل للقيود تلقائيًا. مُطفأ (الافتراضي): تُسحب وتنتظر مراجعتك ثم تضغط «ترحيل» يدويًا.</div>
            </div>
            <Switch checked={autoPostSettlements} onCheckedChange={setAutoPostSettlements} />
          </div>
        </CardContent>
      </Card>

      {/* ٤ — الربط المحاسبي */}
      <Card>
        <CardHeader>
          <CardTitle>الربط المحاسبي</CardTitle>
          <CardDescription>أين تُسجَّل حركات هذه المنصة: المخزن والبنك والعميل.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>المخزن الافتراضي</Label>
            <ComboboxBase
              displayValue={whOptions.find((o) => o.id === warehouseId)?.label ?? ""}
              options={whOptions}
              onPick={(o) => setWarehouseId(o.id)}
              placeholder="ابحث عن مخزن…"
            />
          </div>
          <div className="space-y-2">
            <Label>الحساب البنكي للتسويات</Label>
            <ComboboxBase
              displayValue={bankOptions.find((o) => o.id === bankAccountId)?.label ?? ""}
              options={bankOptions}
              onPick={(o) => setBankAccountId(o.id)}
              placeholder="ابحث عن حساب…"
            />
          </div>
          <div className="space-y-2">
            <Label>عميل المنصة</Label>
            <Input value={platform.customerName ?? "—"} disabled />
            <p className="text-xs text-muted-foreground">تُسجَّل مبيعات المنصة باسم هذا العميل.</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={pending} size="lg">
          {pending && <Loader2 className="size-4 animate-spin" />}حفظ الإعدادات
        </Button>
      </div>
    </div>
  );
}
