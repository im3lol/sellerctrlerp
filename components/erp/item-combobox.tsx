"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { searchItemsAction, type ItemSearchResult } from "@/app/actions/erp/item-search";
import { Input } from "@/components/ui/input";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

/**
 * Searchable item picker — types ahead against name / internal code / any
 * external code (SKU/ASIN/UPC/barcode/marketplace), shows on-hand stock and
 * price, and calls onSelect with the chosen item. Replaces long <select> lists.
 */
export function ItemCombobox({
  onSelect,
  placeholder,
}: {
  onSelect: (item: ItemSearchResult) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ItemSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 1) { setResults([]); return; }
    const t = setTimeout(() => {
      start(async () => {
        const r = await searchItemsAction(q);
        setResults(r);
        setOpen(true);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pick = (item: ItemSearchResult) => {
    onSelect(item);
    setQ("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder={placeholder ?? "ابحث بالاسم أو الكود أو الباركود…"}
      />
      {open && (results.length > 0 || pending) && (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover shadow-lg">
          {results.length === 0 && pending ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">جارٍ البحث…</div>
          ) : (
            results.map((it) => (
              <button
                type="button"
                key={it.id}
                onClick={() => pick(it)}
                className="flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-accent"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{it.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{it.code}</span>
                    {it.codes.length ? " · " + it.codes.slice(0, 3).map((c) => c.code).join(" · ") : ""}
                  </div>
                </div>
                <div className="shrink-0 text-end text-xs">
                  <div className="text-muted-foreground">متاح: {fmt(it.stock)}</div>
                  <div className="font-medium">{fmt(it.sellPrice)}</div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
