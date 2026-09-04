"use client";

import { selectCls } from "@/lib/utils";

/** One transactable unit of an item, as the line forms need it. */
export type FormUnit = { uomId: string; label: string; factor: number; isBase: boolean };

/**
 * Unit picker for a document line. A short, fixed list per item → a plain select, not a
 * searchable combobox (the convention: comboboxes are for entity pickers).
 *
 * Renders nothing but a dash when the item has no extra units — most items never will,
 * and an empty dropdown on every row is noise.
 */
export function UnitCell({
  units, factor, onPick, disabled,
}: {
  units: FormUnit[];
  /** The line's current factor; 1 means the base unit. */
  factor: number;
  onPick: (uomId: string, factor: number) => void;
  disabled?: boolean;
}) {
  const extra = units.filter((u) => !u.isBase);
  const base = units.find((u) => u.isBase);
  if (!extra.length) {
    return <span className="text-xs text-muted-foreground">{base?.label ?? "—"}</span>;
  }

  const current = units.find((u) => Math.abs(u.factor - factor) < 1e-9) ?? base;

  return (
    <select
      className={`${selectCls} w-24 min-w-24`}
      value={current?.uomId ?? ""}
      disabled={disabled}
      aria-label="وحدة البند"
      onChange={(e) => {
        const u = units.find((x) => x.uomId === e.target.value);
        if (u) onPick(u.isBase ? "" : u.uomId, u.factor);
      }}
    >
      {units.map((u) => (
        <option key={u.uomId || "__base__"} value={u.uomId}>
          {u.label}{u.isBase ? "" : ` (${u.factor})`}
        </option>
      ))}
    </select>
  );
}
