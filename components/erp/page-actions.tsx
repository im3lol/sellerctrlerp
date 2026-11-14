import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Keep page actions inside their owning form so native validation and pending state work. */
export function PageActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-page-actions=""
      className={cn(
        "sticky top-16 z-20 flex flex-wrap items-center justify-end gap-2 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur print:hidden [&>button]:max-w-full [&>button]:whitespace-normal",
        className,
      )}
      {...props}
    />
  );
}
