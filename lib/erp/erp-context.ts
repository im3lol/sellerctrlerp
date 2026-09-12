import { AsyncLocalStorage } from "async_hooks";

/**
 * Ambient ERP identity for callers that have already authenticated out-of-band
 * (the Bearer API), so cookie-bound server actions become callable from a route
 * handler. When set, {@link authorizeErp} reads this instead of the session
 * cookie. Request-scoped by AsyncLocalStorage — never leaks between requests.
 */
export type ErpContext = {
  userId: string; orgId: string; role: string; permissions: Set<string>;
  /**
   * True for the queue worker, which acts as the org's admin to drive the marketplace
   * cycle. Manager approvals skip it: an Amazon order's price and discount come from the
   * platform, not from a person who could be asked to justify them.
   */
  system?: boolean;
};

const als = new AsyncLocalStorage<ErpContext>();

export function runWithErpContext<T>(ctx: ErpContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

export function getErpContext(): ErpContext | undefined {
  return als.getStore();
}
