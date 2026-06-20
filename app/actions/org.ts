"use server";

import { cookies } from "next/headers";
import { requireUser } from "@/lib/session";
import { getUserOrganizations, ACTIVE_ORG_COOKIE } from "@/lib/erp/org";

/** Switch the active organization. Validates membership before setting it. */
export async function setActiveOrgAction(orgId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const orgs = await getUserOrganizations(user);
  if (!orgs.some((o) => o.id === orgId)) return { ok: false };

  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  return { ok: true };
}
