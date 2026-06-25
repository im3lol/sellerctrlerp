import { cn } from "@/lib/utils";

/**
 * SellerCtrl wordmark — a single-line typographic logo in the brand (Thmanyah)
 * font. Themeable via `currentColor`: blue-on-white in the app, white-on-blue
 * in the sidebar. The play triangle uses the brand yellow (#F7C52D).
 */
export function Logo({ className, showMark = true }: { className?: string; showMark?: boolean }) {
  return (
    <span
      dir="ltr"
      className={cn(
        "inline-flex select-none items-center font-sans leading-none tracking-[-0.04em]",
        className,
      )}
    >
      <span className="font-light opacity-90">seller</span>
      <span className="font-black">ctrl</span>
      {showMark && (
        <svg
          viewBox="0 0 12 12"
          style={{ height: "0.42em", width: "0.42em", marginInlineStart: "0.15em", transform: "translateY(0.04em)", flexShrink: 0 }}
          fill="hsl(var(--brand-yellow))"
          aria-hidden
        >
          <path d="M2 1.5 L10.5 6 L2 10.5 Z" />
        </svg>
      )}
    </span>
  );
}

/** Square app icon — blue tile with the yellow play mark (favicons, tight spaces). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-8 w-8", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="hsl(var(--brand-blue))" />
      <path d="M11 10 L23 16 L11 22 Z" fill="hsl(var(--brand-yellow))" />
    </svg>
  );
}
