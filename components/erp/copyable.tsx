"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

/** Inline text that copies to the clipboard on click, with a brief ✓ feedback. */
export function Copyable({ text, className, children }: { text: string; className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("تم النسخ");
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("تعذّر النسخ");
    }
  };
  return (
    <button type="button" onClick={copy} title="اضغط للنسخ" className={cn("inline-flex items-center gap-1.5 rounded transition-colors hover:text-primary", className)}>
      {children ?? text}
      <Icon name={copied ? "Check" : "Copy"} className={cn("size-3.5", copied ? "text-emerald-600" : "text-muted-foreground")} />
    </button>
  );
}
