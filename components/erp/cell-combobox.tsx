"use client";

import { ComboboxBase, type ComboOption } from "@/components/erp/combobox-base";

export type CellOption = ComboOption;

/**
 * In-cell searchable combobox for line tables. Shows the selected label; on focus it
 * clears for a typeahead and lists suggestions immediately. Thin wrapper over
 * ComboboxBase (which owns the portal/search/click-outside mechanics).
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
  return (
    <ComboboxBase
      displayValue={selectedLabel}
      options={options}
      onPick={(o) => onSelect(o.id, o.label)}
      placeholder={placeholder}
    />
  );
}
