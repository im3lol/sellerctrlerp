"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { searchItemsAction, type ItemSearchResult } from "@/app/actions/erp/item-search";
import { Input } from "@/components/ui/input";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

/**
 * In-cell searchable item picker for document line tables. Shows the selected
 * item's label; on focus it clears for a typeahead search (name / internal code
 * / any external code / barcode). The results panel renders in a portal with
 * fixed positioning so it is never clipped by the table's overflow.
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
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ddRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => { if (!editing) setQ(selectedLabel ?? ""); }, [selectedLabel, editing]);

  useEffect(() => {
    if (!editing) return;
    const term = q.trim();
    if (term.length < 1) { setResults([]); return; }
    const t = setTimeout(() => start(async () => { setResults(await searchItemsAction(term)); setOpen(true); }), 200);
    return () => clearTimeout(t);
  }, [q, editing]);

  // Keep the portal panel aligned under the input.
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const el = wrapRef.current;
      if (el) { const r = el.getBoundingClientRect(); setRect({ top: r.bottom + 4, left: r.left, width: r.width }); }
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => { window.removeEventListener("scroll", reposition, true); window.removeEventListener("resize", reposition); };
  }, [open]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || ddRef.current?.contains(t)) return;
      setOpen(false); setEditing(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (it: ItemSearchResult) => {
    onSelect(it);
    setEditing(false); setOpen(false); setResults([]);
    setQ(`${it.code} — ${it.name}`);
  };

  const panel =
    mounted && open && editing && rect && (results.length > 0 || pending)
      ? createPortal(
          <div
            ref={ddRef}
            style={{ position: "fixed", top: rect.top, left: rect.left, width: Math.max(rect.width, 280), zIndex: 9999 }}
            className="max-h-72 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-lg"
          >
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
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={wrapRef} className="min-w-48">
      <Input
        value={q}
        placeholder={placeholder ?? "ابحث بالاسم أو الكود…"}
        onFocus={() => { setEditing(true); setQ(""); }}
        onChange={(e) => setQ(e.target.value)}
      />
      {panel}
    </div>
  );
}
