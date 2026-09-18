"use server";

import { cookies } from "next/headers";
import { requireUser } from "@/lib/session";
import { ACTIVE_ORG_COOKIE } from "@/lib/erp/org";
import { createSandbox, deleteSandbox, findSandbox } from "@/lib/erp/sandbox";
import { log } from "@/lib/log";

const cookieOpts = { path: "/", sameSite: "lax" as const, maxAge: 60 * 60 * 24 * 365 };

/** Create (or reopen) the caller's demo company and switch to it. */
export async function createSandboxAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  try {
    const orgId = await createSandbox(user.id);
    (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, cookieOpts);
    return { ok: true };
  } catch (e) {
    log.error("sandbox.create_failed", { userId: user.id, err: e });
    return { ok: false, error: "تعذّر تجهيز الشركة التجريبية — جرّب تاني بعد شوية" };
  }
}

/** Delete the caller's own demo company (only ever a sandbox org they belong to). */
export async function deleteSandboxAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const orgId = await findSandbox(user.id);
  if (!orgId || !(await deleteSandbox(orgId))) return { ok: false, error: "مفيش شركة تجريبية" };
  const jar = await cookies();
  if (jar.get(ACTIVE_ORG_COOKIE)?.value === orgId) jar.delete(ACTIVE_ORG_COOKIE);
  return { ok: true };
}
