"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";

export type ComboOption = { value: string; hint?: string };

/**
 * Free-text search input with a styled suggestions dropdown. The input keeps a
 * `name` so it submits with the surrounding form (manual text still works); the
 * dropdown just makes picking a known item/party easier.
 */
export function LedgerCombobox({
  name,
  defaultValue = "",
  placeholder,
  options,
}: {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  options: ComboOption[];
}) {
  const [q, setQ] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const needle = q.trim().toLowerCase();
  const filtered = (
    needle
      ? options.filter(
          (o) => o.value.toLowerCase().includes(needle) || (o.hint ?? "").toLowerCase().includes(needle),
        )
      : options
  ).slice(0, 50);

  return (
    <div className="relative">
      <Input
        name={name}
        value={q}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          setQ(e.target.value);
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
          {filtered.map((o, i) => (
            <li key={`${o.value}-${i}`}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 rounded-sm px-3 py-1.5 text-right text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  setQ(o.value);
                  setOpen(false);
                }}
              >
                <span>{o.value}</span>
                {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
