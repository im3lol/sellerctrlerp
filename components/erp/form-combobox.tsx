"use client";

import { useState } from "react";
import { ComboboxBase, type ComboOption } from "@/components/erp/combobox-base";

export type FormComboOption = ComboOption;

/**
 * Searchable combobox for NATIVE forms (server actions / method=GET). Same UX as
 * CellCombobox, but self-contained: it keeps its own selection and submits the chosen
 * id through a hidden `<input name>`, so it drops into an existing `<form>` in place of
 * a `<select name>`. Thin wrapper over ComboboxBase.
 */
export function FormCombobox({
  name,
  options,
  defaultValue = "",
  placeholder,
  disabled,
}: {
  name: string;
  options: FormComboOption[];
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [selectedId, setSelectedId] = useState(defaultValue);
  const selectedLabel = options.find((o) => o.id === selectedId)?.label ?? "";
  return (
    <div>
      <input type="hidden" name={name} value={selectedId} />
      <ComboboxBase
        displayValue={selectedLabel}
        options={options}
        onPick={(o) => setSelectedId(o.id)}
        placeholder={placeholder}
        disabled={disabled}
        minWidthClass=""
      />
    </div>
  );
}
