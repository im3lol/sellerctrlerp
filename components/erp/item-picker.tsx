"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { searchItemsAction, type ItemSearchResult } from "@/app/actions/erp/item-search";
import { Image as ImageIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

/** Same treatment as the items table: object-contain in a fixed box, placeholder when the
 *  item has no image, so rows never jump between having one and not. */
function Thumb({ src, className = "size-9" }: { src?: string | null; className?: string }) {
  return (
    <div className={`${className} shrink-0 overflow-hidden rounded-md border bg-muted/40`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-contain" loading="lazy" />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground"><ImageIcon className="size-4" /></div>
      )}
    </div>
  );
}

/**
 * In-cell searchable item picker for document line tables. Shows the selected
 * item's label; on focus it clears for a typeahead search (name / internal code
 * / any external code / barcode). The results panel renders in a portal with
 * fixed positioning so it is never clipped by the table's overflow.
 */
export function ItemPicker({
  selectedLabel,
  selected,
  onSelect,
  placeholder,
}: {
  selectedLabel?: string;
  /** Detail for the RESTING cell (thumbnail + code under the name). Optional: callers that
   *  only have a label keep the plain single-line display they always had. */
  selected?: { name: string; code?: string | null; image?: string | null } | null;
  onSelect: (item: ItemSearchResult) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState(selectedLabel ?? "");
  // The picked row carries image + code; the parent only knows an id, so keep it here.
  const [picked, setPicked] = useState<{ name: string; code?: string | null; image?: string | null } | null>(null);
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
    setPicked({ name: it.name, code: it.code, image: it.image });
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
                  <Thumb src={it.image} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{it.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">{it.code}</span>
                      {it.codes.length ? " · " + it.codes.slice(0, 2).map((c) => c.code).join(" · ") : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-end text-xs">
                    <div className={it.available <= 0 ? "text-destructive font-medium" : "text-muted-foreground"}>متاح: {fmt(it.available)}</div>
                    {it.reserved > 0 && <div className="text-[10px] text-amber-600">محجوز: {fmt(it.reserved)} · رصيد: {fmt(it.stock)}</div>}
                  </div>
                </button>
              ))
            )}
          </div>,
          document.body,
        )
      : null;

  // What the cell shows when it is NOT being searched.
  //
  // A caller that passes `selected` at all — even as null for an empty line — wins over the
  // internally remembered pick, and that ordering is load-bearing: line tables key their rows
  // by index, so deleting a row hands this component instance to the NEXT line. Preferring
  // `picked` there would keep showing the deleted line's item. The parent derives `selected`
  // from the line's own itemId, so it is always the truth. `picked` is the fallback for
  // callers that only pass a label, which is how they get the thumbnail without changing.
  const resting = selected !== undefined ? selected : picked;

  return (
    <div ref={wrapRef} className="min-w-64">
      {resting && !editing ? (
        <button
          type="button"
          onClick={() => { setEditing(true); setQ(""); }}
          className="flex h-auto min-h-9 w-full items-center gap-2 rounded-md border bg-background px-2 py-1 text-start transition-colors hover:bg-accent"
        >
          <Thumb src={resting.image} />
          <span className="min-w-0 flex-1">
            {/* dir="auto" per line: an English name reads from its start (left), an Arabic
                one from its start (right) — never truncated from the middle. */}
            <span className="block truncate text-sm font-medium" dir="auto">{resting.name}</span>
            {resting.code && <span className="block truncate font-mono text-xs text-muted-foreground" dir="ltr">{resting.code}</span>}
          </span>
        </button>
      ) : (
        <Input
          value={q}
          autoFocus={editing}
          // dir="auto" → each name takes its own direction, so a long English name shows
          // from its START (left) and an Arabic one from its start (right), never the middle.
          dir="auto"
          className="text-start"
          placeholder={placeholder ?? "ابحث بالاسم أو الكود…"}
          onFocus={() => { setEditing(true); setQ(""); }}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      {panel}
    </div>
  );
}
