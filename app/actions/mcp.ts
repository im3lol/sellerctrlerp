"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getActiveOrg } from "@/lib/erp/org";
import { approveAuthorization, validateAuthorization, type AuthorizationRequest } from "@/lib/mcp/auth";
import { revokePersonalConnection, personalConnectionCompleted } from "@/lib/mcp/connections";
import { rateLimit } from "@/lib/rate-limit";
import { usesLocalCallbackPopup } from "@/lib/mcp/callback";

export type McpConsentState = { error?: string; callbackUrl?: string; organizationId?: string };
export async function consentMcpAction(input: AuthorizationRequest, _previous: McpConsentState, form: FormData): Promise<McpConsentState> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?expired=1&callbackUrl=${encodeURIComponent(`/mcp/authorize?${new URLSearchParams(Object.entries(input))}`)}`);
  // Validate the registered callback before either approval or rejection redirects.
  let requested: Awaited<ReturnType<typeof validateAuthorization>>;
  try { requested = await validateAuthorization(input); }
  catch { return { error: "طلب ربط المساعد غير صالح أو عنوان الرجوع غير مسجل" }; }
  if (form.get("decision") !== "approve") {
    const target = new URL(input.redirect_uri);
    target.searchParams.set("error", "access_denied");
    if (input.state) target.searchParams.set("state", input.state);
    redirect(target.href);
  }
  const orgId = z.uuid().safeParse(form.get("organization_id"));
  const selected = z.array(z.string()).min(1).safeParse(form.getAll("scope"));
  if (!orgId.success || !selected.success || selected.data.some(s => !requested.scopes.includes(s))) return { error: "طلب ربط المساعد غير صالح" };
  let target: string;
  try { target = await approveAuthorization(user.id, orgId.data, { ...input, scope: [...new Set(selected.data)].join(" ") }); }
  catch { return { error: "تعذر إكمال الربط. راجع اختيار الشركة والصلاحيات وحاول مرة أخرى." }; }
  // Web clients must receive their original browsing context back. Only a
  // registered local CLI callback may use the branded popup handoff.
  if (form.get("popup_handoff") !== "1" || !usesLocalCallbackPopup(input.redirect_uri)) redirect(target);
  return { callbackUrl: target, organizationId: orgId.data };
}
export async function mcpConnectionStatusAction(orgId: string, code: string) {
  const user = await getCurrentUser();
  if (!user || !z.uuid().safeParse(orgId).success || !/^[A-Za-z0-9_-]{43}$/.test(code)) return false;
  if (!await rateLimit(`mcp-status:${user.id}`, 90, 60_000)) return false;
  return personalConnectionCompleted(orgId, user.id, code);
}
export async function revokeMcpAction(form: FormData) {
  const { user, org } = await getActiveOrg();
  if (!user || !org) throw new Error("Unauthorized");
  const id = z.uuid().parse(form.get("grant_id"));
  await revokePersonalConnection(org.id, user.id, id);
  revalidatePath("/settings/mcp");
}
