"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";

export type ComboOption = { id: string; label: string; hint?: string };

/**
 * Shared searchable-combobox core: typeahead, suggestions-on-focus, a portal panel
 * (fixed → never clipped by a table's horizontal overflow), reposition-on-scroll, and
 * click-outside. Callers supply the display value + what to do on pick; this owns all
 * the popover mechanics. CellCombobox / FormCombobox are thin wrappers over it.
 */
export function ComboboxBase({
  displayValue,
  options,
  onPick,
  placeholder,
  disabled,
  minWidthClass = "min-w-40",
  onCreate,
  createLabel = "إنشاء جديد",
}: {
  displayValue: string;
  options: ComboOption[];
  onPick: (o: ComboOption) => void;
  placeholder?: string;
  disabled?: boolean;
  minWidthClass?: string;
  /** Offer a "create it" row at the bottom of the list, handed whatever was typed.
   *  Without it the panel behaves exactly as before. */
  onCreate?: (typed: string) => void;
  createLabel?: string;
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

  const pick = (o: ComboOption) => { onPick(o); setEditing(false); setOpen(false); setQ(""); };

  const panel = mounted && open && rect && (filtered.length > 0 || !!onCreate)
    ? createPortal(
        <div
          ref={ddRef}
          style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, minWidth: rect.width, zIndex: 9999 }}
          className="max-h-72 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {filtered.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => pick(o)}
              className="flex w-full flex-col items-start gap-0.5 rounded-sm px-3 py-1.5 text-start text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <span>{o.label}</span>
              {o.hint && <span className="font-mono text-xs text-muted-foreground">{o.hint}</span>}
            </button>
          ))}
          {onCreate && (
            <>
              {filtered.length > 0 && <div className="my-1 h-px bg-border" />}
              <button
                type="button"
                onClick={() => { const typed = q.trim(); setEditing(false); setOpen(false); setQ(""); onCreate(typed); }}
                className="flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-start text-sm font-medium text-primary hover:bg-accent"
              >
                <Plus className="size-4" />
                {q.trim() ? `${createLabel}: «${q.trim()}»` : createLabel}
              </button>
            </>
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={wrapRef} className={minWidthClass}>
      <Input
        value={editing ? q : displayValue}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
        onFocus={() => { setEditing(true); setQ(""); setOpen(true); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
      />
      {panel}
    </div>
  );
}
