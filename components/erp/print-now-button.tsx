"use client";

/** Triggers the browser print dialog (→ save as PDF). Hidden when printing. */
export function PrintNowButton() {
  return (
    <button onClick={() => window.print()} className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow print:hidden">
      طباعة / حفظ PDF
    </button>
  );
}
