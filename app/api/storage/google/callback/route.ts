import { noticeResponse } from "@/lib/ui-notice-response";
import { cookies } from "next/headers";

import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { authorizeErp } from "@/lib/erp/action-auth";
import { getActiveOrg } from "@/lib/erp/org";
import { verifyCloudState } from "@/lib/erp/storage-cloud-state";
import { cloudCallbackUrl, cloudConnection, CLOUD_PROVIDER, createGoogleFolder, exchangeGoogleCode } from "@/lib/erp/storage-cloud";
import { db } from "@/lib/db";
import { storageCloudConnections } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { withOrgScope } from "@/lib/db-scope";
import { tryRecordAudit } from "@/lib/erp/audit";
import { driveFailure } from "@/lib/erp/storage-cloud-errors";

export async function GET(request: Request) {
  const origin = new URL(cloudCallbackUrl()).origin;
  const finish = (query: string) => {
    const response = noticeResponse(new URL(`/storage/cloud?${query}`, origin));
    response.cookies.set("sellerctrl_drive_state", "", { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/api/storage/google", maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return finish("error=denied");
  const params = new URL(request.url).searchParams;
  const verifier = verifyCloudState((await cookies()).get("sellerctrl_drive_state")?.value ?? "", params.get("state") ?? "", auth.userId, auth.orgId);
  if (!verifier || params.has("error") || !params.get("code")) return finish("error=consent");
  let stage = "token";
  try {
    const tokens = await exchangeGoogleCode(params.get("code")!, verifier);
    const { org } = await getActiveOrg();
    stage = "folder";
    const previous=await cloudConnection(auth.orgId);
    const folder = await createGoogleFolder(tokens.accessToken, auth.orgId, org?.nameAr || "Company",previous??undefined);
    stage = "persist";
    await withOrgScope(auth.orgId, false, async () => {
      // A verified same account/root keeps job checkpoints and scheduling intact.
      if(folder.reused&&previous){
        const updated=await db.update(storageCloudConnections).set({refreshToken:encryptSecret(tokens.refreshToken),connectedBy:auth.userId}).where(and(eq(storageCloudConnections.organizationId,auth.orgId),eq(storageCloudConnections.id,previous.id))).returning({id:storageCloudConnections.id});
        if(!updated.length)throw new Error("Connection changed during consent");
      }else{
      // A different account/root gets a new identity, invalidating old in-flight uploads.
      await db.delete(storageCloudConnections).where(and(eq(storageCloudConnections.organizationId, auth.orgId), eq(storageCloudConnections.provider, CLOUD_PROVIDER)));
      await db.insert(storageCloudConnections).values({ id: randomUUID(), organizationId: auth.orgId, provider: CLOUD_PROVIDER, refreshToken: encryptSecret(tokens.refreshToken), accountEmail: folder.email, folderId: folder.folderId, connectedBy: auth.userId });
      }
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "CLOUD_STORAGE", summary: "ربط Google Drive بالمؤسسة" });
    });
    return finish("connected=1");
  } catch (error) {
    const failure = driveFailure(error, stage);
    console.warn("storage_google_connection_failed", failure.diagnostic);
    return finish(`error=${failure.code}`);
  }
}
