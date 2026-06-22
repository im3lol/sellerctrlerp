"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";

export type ItemFieldOption = { id: string; label: string; hint?: string };

/**
 * Searchable item picker that submits a chosen item's id via a hidden input,
 * with a styled suggestions dropdown. For server-rendered filter forms where a
 * single specific item must be selected (e.g. the per-item stock ledger).
 */
export function ItemPickerField({
  name,
  defaultId = "",
  defaultLabel = "",
  placeholder,
  options,
}: {
  name: string;
  defaultId?: string;
  defaultLabel?: string;
  placeholder?: string;
  options: ItemFieldOption[];
}) {
  const [q, setQ] = useState(defaultLabel);
  const [id, setId] = useState(defaultId);
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const needle = q.trim().toLowerCase();
  const filtered = (
    needle
      ? options.filter(
          (o) => o.label.toLowerCase().includes(needle) || (o.hint ?? "").toLowerCase().includes(needle),
        )
      : options
  ).slice(0, 50);

  return (
    <div className="relative min-w-64">
      <input type="hidden" name={name} value={id} />
      <Input
        value={q}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          setQ(e.target.value);
          setId("");
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
      />
      {open && filtered.length > 0 && (
        <ul
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          onMouseDown={(e) => e.preventDefault()}
        >
          {filtered.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 rounded-sm px-3 py-1.5 text-right text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  setQ(o.label);
                  setId(o.id);
                  setOpen(false);
                }}
              >
                <span>{o.label}</span>
                {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
