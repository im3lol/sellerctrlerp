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
  onCreate,
  createLabel,
}: {
  selectedLabel: string;
  options: CellOption[];
  onSelect: (id: string, label: string) => void;
  placeholder?: string;
  /** Show a "create it" row at the bottom of the list, handed whatever was typed. */
  onCreate?: (typed: string) => void;
  createLabel?: string;
}) {
  return (
    <ComboboxBase
      displayValue={selectedLabel}
      options={options}
      onPick={(o) => onSelect(o.id, o.label)}
      placeholder={placeholder}
      onCreate={onCreate}
      createLabel={createLabel}
    />
  );
}
