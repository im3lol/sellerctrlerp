"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Logo, LogoMark } from "@/components/brand/logo";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetClose } from "@/components/ui/sheet";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export function StorageShell({ children, account, admin, appUrl, manageCloud }: { children: React.ReactNode; account: React.ReactNode; admin: boolean; appUrl: string; manageCloud: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const current = pathname.includes("/admin") ? "admin" : pathname.includes("/cloud") ? "cloud" : params.get("view") || "backups";
  const links = [
    { key: "backups", href: "/storage", icon: "DatabaseBackup", label: "النسخ الاحتياطي" },
    { key: "files", href: "/storage?view=files", icon: "FolderOpen", label: "الملفات" },
    { key: "images", href: "/storage?view=images", icon: "Images", label: "صور الأصناف" },
    { key: "data", href: "/storage?view=data", icon: "Table2", label: "تنزيل الجداول" },
    ...(manageCloud ? [{ key: "cloud", href: "/storage/cloud", icon: "Cloud", label: "متقدم: التخزين السحابي" }] : []),
    ...(admin ? [{ key: "admin", href: "/storage/admin", icon: "Server", label: "المؤسسات وموارد النظام" }] : []),
  ];
  const navigation = <>
    <Link href="/storage" onClick={() => setOpen(false)} className="flex h-20 items-center px-6" aria-label="SellerCtrl"><Logo variant="white" className="text-2xl" /></Link>
    <div className="px-6 pb-5 text-sm text-sidebar-foreground/70">{t("الملفات والبيانات")}</div>
    <nav aria-label={t("الملفات والبيانات")} className="flex-1 space-y-2 px-3">
      {links.map(link => <Link key={link.key} href={link.href} onClick={() => setOpen(false)} aria-current={current === link.key ? "page" : undefined} className={cn("flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2", current === link.key ? "bg-white font-semibold text-primary shadow-sm" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white")}><Icon name={link.icon} className="size-5 shrink-0" /><span>{t(link.label)}</span></Link>)}
    </nav>
    <div className="m-3 border-t border-sidebar-border pt-3"><a href={appUrl} className="flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"><Icon name="LayoutDashboard" className="size-5" />{t("الرجوع للداش بورد")}</a>{admin && <a href={new URL("/admin", appUrl).href} className="flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"><Icon name="ShieldCheck" className="size-5" />{t("لوحة الإدارة")}</a>}</div>
  </>;
  return <div className="flex min-h-dvh bg-muted/30">
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">{navigation}</aside>
    <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-30 flex min-h-16 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:px-8">
        <Button type="button" variant="outline" size="icon" className="shrink-0 lg:hidden" onClick={() => setOpen(true)} aria-label={t("فتح القائمة")} aria-expanded={open}><Icon name="Menu" className="size-5" /></Button>
        <span className="lg:hidden" aria-label="SellerCtrl"><LogoMark className="text-2xl" /></span>
        <span className="hidden text-sm font-semibold sm:block">{t(links.find(link => link.key === current)?.label ?? "الملفات والبيانات")}</span>
        <div className="ms-auto flex min-w-0 items-center gap-3">{account}</div>
        <a href={appUrl} aria-label={t("الرجوع للداش بورد")} title={t("الرجوع للداش بورد")} className="grid size-10 shrink-0 place-items-center rounded-lg border text-primary hover:bg-muted"><Icon name="LayoutDashboard" className="size-4" /></a>
      </header>
      <main className="mx-auto max-w-[1440px] space-y-5 p-4 md:space-y-6 md:p-8">{children}</main>
    </div>
    <Sheet open={open} onOpenChange={setOpen}><SheetContent side="right" className="gap-0 overflow-y-auto border-0 bg-sidebar pb-[env(safe-area-inset-bottom)] text-sidebar-foreground" showCloseButton={false}>
      <SheetTitle className="sr-only">{t("الملفات والبيانات")}</SheetTitle><SheetDescription className="sr-only">{t("القائمة الرئيسية")}</SheetDescription>
      <SheetClose asChild><button className="absolute end-3 top-5 rounded-lg p-2 hover:bg-sidebar-accent" aria-label={t("إغلاق")}><Icon name="X" className="size-5" /></button></SheetClose>
      {navigation}
    </SheetContent></Sheet>
  </div>;
}
