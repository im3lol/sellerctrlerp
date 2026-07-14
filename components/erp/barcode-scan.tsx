"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { scanItemAction, type ItemSearchResult } from "@/app/actions/erp/item-search";
import { isNativeApp, scanBarcode } from "@/lib/native";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/icon";

/**
 * Barcode scan field — a keyboard-wedge scanner types the code and presses
 * Enter; we resolve it to an item (exact normalized match) and call onScan so
 * the form adds a line or bumps its quantity. Unknown codes toast an error.
 * Inside the Android app a camera button opens the native scanner and feeds
 * the same resolve path.
 */
export function BarcodeScan({ onScan }: { onScan: (item: ItemSearchResult) => void }) {
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  const [native, setNative] = useState(false);
  useEffect(() => { setNative(isNativeApp()); }, []);

  const resolve = (c: string) => {
    const v = c.trim();
    if (!v) return;
    start(async () => {
      const it = await scanItemAction(v);
      if (it) { onScan(it); setCode(""); }
      else toast.error(`كود غير معروف: ${v}`);
    });
  };

  const camera = async () => {
    const value = await scanBarcode();
    if (value) resolve(value);
  };

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Icon name="ScanLine" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={code}
          disabled={pending}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); resolve(code); } }}
          placeholder="امسح الباركود ثم Enter…"
          className="ps-9"
        />
      </div>
      {native && (
        <button type="button" onClick={camera} disabled={pending} aria-label="مسح بالكاميرا"
          className="grid size-9 shrink-0 place-items-center rounded-md border bg-primary text-primary-foreground disabled:opacity-50">
          <Icon name="Camera" className="size-4" />
        </button>
      )}
    </div>
  );
}
