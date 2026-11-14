import { noticeResponse } from "@/lib/ui-notice-response";
import { NextResponse } from "next/server";
import { authorizeErp } from "@/lib/erp/action-auth";
import { cloudCallbackUrl, DRIVE_SCOPE, googleDriveConfig } from "@/lib/erp/storage-cloud";
import { createCloudState } from "@/lib/erp/storage-cloud-state";

export async function GET(request: Request) {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return new Response("Forbidden", { status: 403 });
  const origin = new URL(cloudCallbackUrl()).origin;
  // Caddy terminates TLS, so Next's internal request URL can use http. Compare
  // hosts rather than schemes to avoid redirecting the public URL to itself.
  if ((request.headers.get("host") || new URL(request.url).host).toLowerCase() !== new URL(origin).host.toLowerCase()) return NextResponse.redirect(new URL("/api/storage/google/start", origin));
  const config = await googleDriveConfig();
  if (!config) return noticeResponse(new URL("/storage/cloud?error=config", origin));
  const state = createCloudState(auth.userId, auth.orgId);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: cloudCallbackUrl(), response_type: "code", scope: DRIVE_SCOPE, access_type: "offline", prompt: "consent", state: state.nonce, code_challenge: state.challenge, code_challenge_method: "S256" }).toString();
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set("sellerctrl_drive_state", state.cookie, { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/api/storage/google", maxAge: 600 });
  return response;
}
