"use client";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { AdminSidebar } from "./admin-sidebar";
import { Logo } from "@/components/brand/logo";
import { useLocale, useT } from "@/lib/i18n/client";

export function AdminMobileNav() {
 const [open,setOpen]=useState(false);const t=useT();const locale=useLocale();
 return <Sheet open={open} onOpenChange={setOpen}><SheetTrigger className="grid size-10 shrink-0 place-items-center rounded-lg border lg:hidden" aria-label={t("فتح القائمة")}><Menu className="size-5" /></SheetTrigger><SheetContent side={locale==="ar"?"right":"left"} className="flex w-72 flex-col gap-0 bg-sidebar p-0 pb-[env(safe-area-inset-bottom)] text-sidebar-foreground"><SheetTitle className="sr-only">{t("لوحة الإدارة")}</SheetTitle><SheetDescription className="sr-only">{t("القائمة الرئيسية")}</SheetDescription><div className="flex h-20 shrink-0 items-center px-6"><Logo variant="white" className="text-2xl" /></div><AdminSidebar onNavigate={()=>setOpen(false)} /></SheetContent></Sheet>;
}
