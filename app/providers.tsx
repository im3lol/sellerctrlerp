"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmHost } from "@/components/erp/confirm";
import { LocaleProvider } from "@/lib/i18n/client";
import { dirOf, type Locale } from "@/lib/i18n";

export function Providers({ children, locale }: { children: React.ReactNode; locale: Locale }) {
  return (
    // next-themes toggles the `.dark` class on <html> (the palette already exists in
    // globals.css); it injects a pre-hydration script so there's no theme flash.
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <LocaleProvider locale={locale}>
        <TooltipProvider delayDuration={150}>
          {children}
          <Toaster richColors position="top-center" dir={dirOf(locale)} />
          <ConfirmHost />
        </TooltipProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
