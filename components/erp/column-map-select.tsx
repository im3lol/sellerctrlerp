"use client";

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { selectCls } from "@/lib/utils";

/**
 * One "map a spreadsheet column onto a field" dropdown, shared by the CSV/Excel import
 * views (orders, returns, payments, removals).
 *
 * It lives at module scope on purpose. Each import view used to declare this inline, which
 * meant React saw a brand-new component type on every render and remounted the <select> —
 * losing focus and any open dropdown mid-edit. Hoisting it makes the element identity
 * stable; `react-hooks/static-components` is the rule that flags the old shape.
 */
export function ColumnMapSelect({
  label,
  optional,
  value,
  colOptions,
  onChange,
}: {
  label: string;
  optional?: boolean;
  value: string;
  colOptions: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {optional && <span className="text-muted-foreground"> (اختياري)</span>}
      </Label>
      <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— اختر العمود —</option>
        {colOptions}
      </select>
    </div>
  );
}
