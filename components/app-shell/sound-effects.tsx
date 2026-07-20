"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { playChime } from "@/lib/sound";

// Delete/cancel wording → the "delete" chime; every other success → "confirm".
const DELETE_RE = /حذف|مسح|إلغاء|ملغى|إلغا/;

let patched = false;

/**
 * Wraps sonner's `toast.success` once so every success toast plays a chime —
 * confirm vs delete inferred from the message — without touching the hundreds of
 * call sites. New-notification chimes are fired by the bell itself.
 */
export function SoundEffects() {
  useEffect(() => {
    if (patched) return;
    patched = true;
    const orig = toast.success.bind(toast);
    toast.success = ((msg: Parameters<typeof toast.success>[0], opts: Parameters<typeof toast.success>[1]) => {
      const text = typeof msg === "string" ? msg : "";
      playChime(DELETE_RE.test(text) ? "delete" : "confirm");
      return orig(msg, opts);
    }) as typeof toast.success;
  }, []);
  return null;
}
