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
  const parent = als.getStore();
  if (parent && (parent.userId !== ctx.userId || parent.orgId !== ctx.orgId ||
    parent.role !== ctx.role || (ctx.system && !parent.system) ||
    [...ctx.permissions].some(permission => !parent.permissions.has(permission)))) {
    throw new Error("Cannot change identity or elevate permissions inside an ERP request");
  }
  return als.run({ ...ctx, permissions: new Set(ctx.permissions) }, fn);
}

export function getErpContext(): ErpContext | undefined {
  return als.getStore();
}
