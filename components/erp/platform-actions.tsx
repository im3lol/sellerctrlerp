"use client";

import { useState } from "react";
import Link from "next/link";
import { Upload, Download, ShoppingCart, Banknote, Boxes } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Choice = "choose" | "import" | "export";

function OptionCard({ href, download, onClick, icon, title, subtitle, disabled }: {
  href?: string; download?: boolean; onClick?: () => void; icon: React.ReactNode; title: string; subtitle: string; disabled?: boolean;
}) {
  const cls = "flex w-full items-center gap-3 rounded-xl border p-4 text-start transition-colors hover:border-primary hover:bg-accent disabled:pointer-events-none disabled:opacity-50";
  const body = (
    <>
      <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</div>
      <div className="min-w-0"><div className="font-medium">{title}</div><div className="text-xs text-muted-foreground">{subtitle}</div></div>
    </>
  );
  if (disabled) return <div className={`${cls} opacity-50`}>{body}</div>;
  if (href) return <Link href={href} download={download} onClick={onClick} className={cls}>{body}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{body}</button>;
}

/** Import/export dialog for a platform. Controlled by the parent (opened from the
 *  platform tools dropdown) — it renders no trigger of its own. */
export function PlatformActions({ code, isAmazon, open, onOpenChange }: {
  code: string; isAmazon: boolean; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const [mode, setMode] = useState<Choice>("choose");
  const base = `/platforms/${code}`;
  const paymentsTab = isAmazon ? "settlement" : "payments";
  const close = () => { onOpenChange(false); setMode("choose"); };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {mode === "choose" ? "استيراد أو تصدير" : mode === "import" ? "اختر نوع الاستيراد" : "اختر نوع التصدير"}
            </DialogTitle>
            <DialogDescription>
              {mode === "choose" ? "اختر ما تريد فعله لهذه المنصة." : "البيانات مرتبطة بعميل المنصة ومخزنها وحسابها البنكي."}
            </DialogDescription>
          </DialogHeader>

          {mode === "choose" && (
            <div className="grid gap-3">
              <OptionCard onClick={() => setMode("import")} icon={<Upload className="size-5" />} title="استيراد" subtitle="مبيعات · مدفوعات · مخزون" />
              <OptionCard onClick={() => setMode("export")} icon={<Download className="size-5" />} title="تصدير" subtitle="تنزيل بيانات المنصة كملف Excel" />
            </div>
          )}

          {mode === "import" && (
            <div className="grid gap-3">
              <OptionCard href={`${base}/import?tab=orders`} onClick={close} icon={<ShoppingCart className="size-5" />} title="مبيعات" subtitle="استيراد أوامر البيع من ملف المنصة" />
              <OptionCard href={`${base}/import?tab=${paymentsTab}`} onClick={close} icon={<Banknote className="size-5" />} title="مدفوعات" subtitle={isAmazon ? "من تقرير التسويات" : "سندات قبض على حساب المنصة البنكي"} />
              <OptionCard href={`${base}/import?tab=inventory`} onClick={close} icon={<Boxes className="size-5" />} title="مخزون" subtitle="مطابقة مستويات المخزون" />
              <OptionCard href={`${base}/import?tab=removals`} onClick={close} icon={<Boxes className="size-5" />} title="إزالات وإتلاف" subtitle="الوحدات المُتلَفة/المُرتجَعة من المخزن" />
              <button type="button" onClick={() => setMode("choose")} className="text-sm text-muted-foreground hover:text-foreground">→ رجوع</button>
            </div>
          )}

          {mode === "export" && (
            <div className="grid gap-3">
              <OptionCard href={`/api/erp/platforms/${code}/orders/export`} download onClick={close} icon={<ShoppingCart className="size-5" />} title="مبيعات (Excel)" subtitle="تنزيل كل أوامر المنصة" />
              <OptionCard icon={<Banknote className="size-5" />} title="مدفوعات (قريبًا)" subtitle="تصدير المدفوعات — قيد التطوير" disabled />
              <OptionCard icon={<Boxes className="size-5" />} title="مخزون (قريبًا)" subtitle="تصدير المخزون — قيد التطوير" disabled />
              <button type="button" onClick={() => setMode("choose")} className="text-sm text-muted-foreground hover:text-foreground">→ رجوع</button>
            </div>
          )}
        </DialogContent>
      </Dialog>
  );
}
