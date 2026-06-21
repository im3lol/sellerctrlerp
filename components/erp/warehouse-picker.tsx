"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import type { WarehouseStock } from "@/app/actions/erp/stock";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

/**
 * In-cell searchable warehouse picker for document line tables. Filters a local
 * list of warehouses (with on-hand qty) by name; the panel renders in a portal
 * with fixed positioning so it is never clipped by the table's overflow.
 */
export function WarehousePicker({
  options,
  value,
  onSelect,
  disabled,
  placeholder,
}: {
  options: WarehouseStock[];
  value: string;
  onSelect: (warehouseId: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const selected = options.find((o) => o.warehouseId === value);
  const label = selected ? `${selected.name} — ${fmt(selected.qty)}` : "";

  const [q, setQ] = useState(label);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ddRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => { if (!editing) setQ(label); }, [label, editing]);

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

  const term = q.trim().toLowerCase();
  const filtered = editing && term ? options.filter((o) => o.name.toLowerCase().includes(term)) : options;

  const pick = (o: WarehouseStock) => {
    onSelect(o.warehouseId);
    setEditing(false); setOpen(false);
    setQ(`${o.name} — ${fmt(o.qty)}`);
  };

  const panel = mounted && open && editing && rect && options.length > 0
    ? createPortal(
        <div
          ref={ddRef}
          style={{ position: "fixed", top: rect.top, left: rect.left, width: Math.max(rect.width, 220), zIndex: 9999 }}
          className="max-h-72 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-lg"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">لا نتائج</div>
          ) : (
            filtered.map((o) => (
              <button type="button" key={o.warehouseId} onClick={() => pick(o)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start hover:bg-accent">
                <span className="truncate text-sm">{o.name}</span>
                <span className={`shrink-0 text-xs tabular-nums ${o.qty > 0 ? "text-muted-foreground" : "text-destructive"}`}>{fmt(o.qty)}</span>
              </button>
            ))
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={wrapRef} className="min-w-40">
      <Input
        value={q}
        disabled={disabled}
        placeholder={placeholder ?? "ابحث عن مستودع…"}
        onFocus={() => { setEditing(true); setQ(""); setOpen(true); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
      />
      {panel}
    </div>
  );
}
