"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";

export type CellOption = { id: string; label: string; hint?: string };

/**
 * In-cell searchable combobox for line tables. Shows the selected label; on focus
 * it clears for a typeahead and lists suggestions immediately (before typing).
 * The panel renders in a portal (fixed) so it is never clipped by the table's
 * horizontal overflow. Styled with the app's popover tokens.
 */
export function CellCombobox({
  selectedLabel,
  options,
  onSelect,
  placeholder,
}: {
  selectedLabel: string;
  options: CellOption[];
  onSelect: (id: string, label: string) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ddRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

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

  const needle = q.trim().toLowerCase();
  const filtered = (
    needle
      ? options.filter((o) => o.label.toLowerCase().includes(needle) || (o.hint ?? "").toLowerCase().includes(needle))
      : options
  ).slice(0, 50);

  const pick = (o: CellOption) => { onSelect(o.id, o.label); setEditing(false); setOpen(false); setQ(""); };

  const panel = mounted && open && rect && filtered.length > 0
    ? createPortal(
        <div
          ref={ddRef}
          style={{ position: "fixed", top: rect.top, left: rect.left, width: Math.max(rect.width, 240), zIndex: 9999 }}
          className="max-h-72 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {filtered.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => pick(o)}
              className="flex w-full flex-col items-start gap-0.5 rounded-sm px-3 py-1.5 text-right text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <span>{o.label}</span>
              {o.hint && <span className="font-mono text-xs text-muted-foreground">{o.hint}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={wrapRef} className="min-w-40">
      <Input
        value={editing ? q : selectedLabel}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => { setEditing(true); setQ(""); setOpen(true); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
      />
      {panel}
    </div>
  );
}
