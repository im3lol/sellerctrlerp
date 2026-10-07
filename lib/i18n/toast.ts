"use client";

import { toast as base } from "sonner";
import { isLocale, translator } from "@/lib/i18n";

/**
 * `toast` from sonner, translated. Every message a server action returns (`{ error: "…" }`),
 * and every message thrown deep in lib/erp and caught on the way out, reaches the user
 * through a toast — so this is the one place that translates them all, without touching
 * the server code that wrote them. The page's <html lang> is the locale (set by the root
 * layout); a message with no dictionary entry, or already in English, passes through.
 *
 * Import this instead of "sonner": `import { toast } from "@/lib/i18n/toast"`.
 */
type Msg = Parameters<typeof base.success>[0];
type Opts = Parameters<typeof base.success>[1];

function tr<M>(m: M): M {
  if (typeof m !== "string" || typeof document === "undefined") return m;
  const lang = document.documentElement.lang;
  return (isLocale(lang) ? translator(lang)(m) : m) as M;
}

const opts = (o?: Opts): Opts =>
  o && typeof o.description === "string" ? { ...o, description: tr(o.description) } : o;

const wrap = (f: typeof base.success) => (m: Msg, o?: Opts) => f(tr(m), opts(o));

export const toast: typeof base = Object.assign((m: Msg, o?: Opts) => base(tr(m), opts(o)), base, {
  success: wrap(base.success),
  error: wrap(base.error),
  info: wrap(base.info),
  warning: wrap(base.warning),
  message: wrap(base.message),
  loading: wrap(base.loading),
});
