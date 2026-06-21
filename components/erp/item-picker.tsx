"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { searchItemsAction, type ItemSearchResult } from "@/app/actions/erp/item-search";
import { Input } from "@/components/ui/input";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

/**
 * In-cell searchable item picker for document line tables. Shows the selected
 * item's label; on focus it clears for a typeahead search (name / internal code
 * / any external code / barcode) and calls onSelect with the chosen item. If the
 * user leaves without picking, the previous selection is restored.
 */
export function ItemPicker({
  selectedLabel,
  onSelect,
  placeholder,
}: {
  selectedLabel?: string;
  onSelect: (item: ItemSearchResult) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState(selectedLabel ?? "");
  const [results, setResults] = useState<ItemSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);

  // Mirror the external selection whenever we're not actively editing.
  useEffect(() => { if (!editing) setQ(selectedLabel ?? ""); }, [selectedLabel, editing]);

  useEffect(() => {
    if (!editing) return;
    const term = q.trim();
    if (term.length < 1) { setResults([]); return; }
    const t = setTimeout(() => start(async () => { setResults(await searchItemsAction(term)); setOpen(true); }), 200);
    return () => clearTimeout(t);
  }, [q, editing]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setEditing(false); }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pick = (it: ItemSearchResult) => {
    onSelect(it);
    setEditing(false); setOpen(false); setResults([]);
    setQ(`${it.code} — ${it.name}`);
  };

  return (
    <div ref={boxRef} className="relative min-w-48">
      <Input
        value={q}
        placeholder={placeholder ?? "ابحث بالاسم أو الكود…"}
        onFocus={() => { setEditing(true); setQ(""); }}
        onChange={(e) => setQ(e.target.value)}
      />
      {open && editing && (results.length > 0 || pending) && (
        <div className="absolute z-50 mt-1 max-h-72 w-full min-w-64 overflow-auto rounded-md border bg-popover shadow-lg">
          {results.length === 0 && pending ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">جارٍ البحث…</div>
          ) : (
            results.map((it) => (
              <button type="button" key={it.id} onClick={() => pick(it)} className="flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-accent">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{it.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{it.code}</span>
                    {it.codes.length ? " · " + it.codes.slice(0, 2).map((c) => c.code).join(" · ") : ""}
                  </div>
                </div>
                <div className="shrink-0 text-end text-xs text-muted-foreground">متاح: {fmt(it.stock)}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
