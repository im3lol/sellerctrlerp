import { revalidatePath as nextRevalidatePath } from "next/cache";

/**
 * revalidatePath that no-ops outside a request scope. The server actions are also
 * invoked from the queue worker (auto order fulfilment runs the same actions with
 * an ambient ErpContext) where Next's static-generation store doesn't exist and
 * the real revalidatePath throws "Invariant: static generation store missing".
 * There is nothing to revalidate there — the web UI re-renders on navigation.
 */
export function revalidatePath(path: string, type?: "layout" | "page"): void {
  try {
    nextRevalidatePath(path, type);
  } catch {
    // worker/cron: no request scope — nothing to invalidate
  }
}
