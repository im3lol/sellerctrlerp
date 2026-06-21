"use client";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmHost } from "@/components/erp/confirm";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      {children}
      <Toaster richColors position="top-center" dir="rtl" />
      <ConfirmHost />
    </TooltipProvider>
  );
}
