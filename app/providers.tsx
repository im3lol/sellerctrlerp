"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmHost } from "@/components/erp/confirm";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // next-themes toggles the `.dark` class on <html> (the palette already exists in
    // globals.css); it injects a pre-hydration script so there's no theme flash.
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={150}>
        {children}
        <Toaster richColors position="top-center" dir="rtl" />
        <ConfirmHost />
      </TooltipProvider>
    </ThemeProvider>
  );
}
