"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmHost } from "@/components/erp/confirm";
import { LocaleProvider } from "@/lib/i18n/client";
import { dirOf, type Locale } from "@/lib/i18n";

export function Providers({ children, locale }: { children: React.ReactNode; locale: Locale }) {
  return (
    // Force light before hydration, ignoring old saved themes and the OS setting.
    <ThemeProvider attribute="class" forcedTheme="light" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
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
