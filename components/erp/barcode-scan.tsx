"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { scanItemAction, type ItemSearchResult } from "@/app/actions/erp/item-search";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/icon";

/**
 * Barcode scan field — a keyboard-wedge scanner types the code and presses
 * Enter; we resolve it to an item (exact normalized match) and call onScan so
 * the form adds a line or bumps its quantity. Unknown codes toast an error.
 */
export function BarcodeScan({ onScan }: { onScan: (item: ItemSearchResult) => void }) {
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();

  const submit = () => {
    const c = code.trim();
    if (!c) return;
    start(async () => {
      const it = await scanItemAction(c);
      if (it) { onScan(it); setCode(""); }
      else toast.error(`كود غير معروف: ${c}`);
    });
  };

  return (
    <div className="relative">
      <Icon name="ScanLine" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
      <Input
        value={code}
        disabled={pending}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
        placeholder="امسح الباركود ثم Enter…"
        className="ps-9"
      />
    </div>
  );
}
