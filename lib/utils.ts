import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Canonical styling for a native `<select>` (and lookalike form controls) — the ERP
 * uses native selects for enum/short lists. Was copy-pasted as a local `selectCls` in
 * ~59 files; centralized here so the whole app restyles from one place.
 */
export const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";
