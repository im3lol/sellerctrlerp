import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformIntegrations, storageCloudConnections } from "@/db/schema";
import { withOrgScope, withPlatformScope } from "@/lib/db-scope";
import { decryptSecret } from "@/lib/crypto";
import { DriveProviderError, safeGoogleReason, type DriveOperation } from "@/lib/erp/storage-cloud-errors";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_CONFIG = "STORAGE_GOOGLE_DRIVE";
export const CLOUD_PROVIDER = "google-drive";
export const cloudCallbackUrl = () => new URL("/api/storage/google/callback", process.env.STORAGE_PORTAL_URL || process.env.APP_URL || "http://localhost:3000").href;

export async function googleDriveConfig() {
  const [row] = await withPlatformScope(() => db.select().from(platformIntegrations).where(eq(platformIntegrations.code, DRIVE_CONFIG)).limit(1));
  const clientId = row?.clientId || process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = row?.clientSecret ? decryptSecret(row.clientSecret) : process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  return row?.enabled !== false && clientId && clientSecret ? { clientId, clientSecret } : null;
}

export async function cloudConnection(orgId: string) {
  const [row] = await withOrgScope(orgId, false, () => db.select().from(storageCloudConnections).where(and(eq(storageCloudConnections.organizationId, orgId), eq(storageCloudConnections.provider, CLOUD_PROVIDER))).limit(1));
  return row ?? null;
}

/** Never propagate provider response bodies (which can include OAuth secrets). */
async function jsonResponse(response: Response, operation: DriveOperation): Promise<Record<string, unknown>> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new DriveProviderError(operation, response.status, safeGoogleReason(data));
  return data;
}

export async function exchangeGoogleCode(code: string, verifier: string) {
  const config = await googleDriveConfig();
  if (!config) throw new Error("Cloud provider is not configured");
  const data = await jsonResponse(await fetch("https://oauth2.googleapis.com/token", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000), body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: cloudCallbackUrl() }) }), "token");
  if (typeof data.access_token !== "string") throw new DriveProviderError("token", 200, "missing_access_token");
  if (typeof data.refresh_token !== "string") throw new DriveProviderError("token", 200, "missing_refresh_token");
  if (typeof data.scope !== "string" || !data.scope.split(" ").includes(DRIVE_SCOPE)) throw new DriveProviderError("token", 200, "consent_missing");
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

export async function refreshGoogleToken(refreshToken: string) {
  const config = await googleDriveConfig();
  if (!config) throw new Error("Cloud provider is not configured");
  const data = await jsonResponse(await fetch("https://oauth2.googleapis.com/token", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000), body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }) }), "token");
  if (typeof data.access_token !== "string") throw new Error("Cloud account must reconnect");
  return data.access_token;
}

export function driveFolderUrl(id: string) {
  return /^[A-Za-z0-9_-]+$/.test(id) ? `https://drive.google.com/drive/folders/${id}` : null;
}

export async function createGoogleFolder(accessToken: string, orgId: string, orgName: string, previous?: {folderId:string;accountEmail:string}) {
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  const account = await jsonResponse(await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", { headers, cache: "no-store", signal: AbortSignal.timeout(20000) }), "account");
  const email = (account.user as { emailAddress?: string } | undefined)?.emailAddress;
  if (!email) throw new DriveProviderError("account", 200, "identity_missing");
  if(previous&&previous.accountEmail.toLowerCase()===email.toLowerCase()&&driveFolderUrl(previous.folderId)){
    const checked=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(previous.folderId)}?fields=mimeType,trashed,appProperties,capabilities(canAddChildren)`,{headers,cache:"no-store",signal:AbortSignal.timeout(20000)});
    if(checked.status!==404){
      const metadata=await jsonResponse(checked,"folder");
      if(metadata.mimeType==="application/vnd.google-apps.folder"&&metadata.trashed!==true&&(metadata.appProperties as Record<string,string>|undefined)?.sellerctrlOrg===orgId&&(metadata.capabilities as {canAddChildren?:boolean}|undefined)?.canAddChildren)return {folderId:previous.folderId,email,reused:true};
    }
  }
  const folder = await jsonResponse(await fetch("https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers, signal: AbortSignal.timeout(20000), body: JSON.stringify({ name: `SellerCtrl - ${orgName}`, mimeType: "application/vnd.google-apps.folder", appProperties: { sellerctrlOrg: orgId } }) }), "folder");
  if (typeof folder.id !== "string" || !driveFolderUrl(folder.id)) throw new Error("Invalid Drive folder");
  return { folderId: folder.id, email, reused:false };
}

export async function uploadGoogleBackup(accessToken: string, folderId: string, filename: string, buffer: Buffer) {
  return uploadGoogleFile(accessToken, folderId, filename, buffer, "application/gzip", "application/gzip");
}

export async function createGoogleBackupFolder(accessToken: string, parentId: string, name: string, jobId?: string) {
  if (!driveFolderUrl(parentId)) throw new Error("Invalid backup parent folder");
  const folder = await jsonResponse(await fetch("https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ name, parents: [parentId], mimeType: "application/vnd.google-apps.folder", appProperties: { sellerctrlBackup: "1", ...(jobId ? { sellerctrlJob: jobId } : {}) } }) }), "folder");
  if (typeof folder.id !== "string" || !driveFolderUrl(folder.id)) throw new Error("Backup folder creation not confirmed");
  return folder.id;
}

export async function uploadGoogleWorkbookFiles(accessToken: string, folderId: string, files: { name: string; buffer: Buffer }[]) {
  const ids: string[] = [];
  // Bounded batches avoid flooding the user's Google account with parallel jobs.
  for (let offset = 0; offset < files.length; offset += 3) {
    const batch = await Promise.allSettled(files.slice(offset, offset + 3).map(file => uploadGoogleWorkbook(accessToken, folderId, `${file.name}.xlsx`, file.buffer)));
    const failed = batch.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    for (const result of batch) if (result.status === "fulfilled") ids.push(result.value);
  }
  return ids;
}

export async function uploadGoogleWorkbook(accessToken: string, folderId: string, filename: string, buffer: Buffer) {
  return uploadGoogleFile(accessToken, folderId, filename.replace(/\.xlsx$/i, ""), buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.google-apps.spreadsheet");
}

async function uploadGoogleFile(accessToken: string, folderId: string, filename: string, buffer: Buffer, contentType: string, targetType: string) {
  if (!driveFolderUrl(folderId)) throw new Error("Invalid Drive folder");
  const start = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,mimeType", { method: "POST", signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "X-Upload-Content-Type": contentType, "X-Upload-Content-Length": String(buffer.length) }, body: JSON.stringify({ name: filename, parents: [folderId], mimeType: targetType }) });
  if (!start.ok) await jsonResponse(start, "upload");
  const location = new URL(start.headers.get("location") || "https://invalid.local");
  if (location.protocol !== "https:" || location.hostname !== "www.googleapis.com" || location.port || location.username || location.password || !location.pathname.startsWith("/upload/drive/")) throw new Error("Invalid cloud upload destination");
  const saved = await jsonResponse(await fetch(location, { method: "PUT", redirect: "error", signal: AbortSignal.timeout(120000), headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": contentType }, body: new Uint8Array(buffer) }), "upload");
  if (typeof saved.id !== "string") throw new Error("Cloud upload not confirmed");
  if (targetType === "application/vnd.google-apps.spreadsheet" && saved.mimeType !== targetType) throw new Error("Google Sheets conversion not confirmed");
  return saved.id;
}


const driveEscape = (value:string) => value.replace(/\\/g,"\\\\").replace(/'/g,"\\'");
export async function listGoogleBackupChildren(access:string,parent:string):Promise<{id:string;name:string;mimeType:string}[]> {
 if(!driveFolderUrl(parent))throw new Error("Invalid Drive parent");
 const query=new URLSearchParams({q:`'${driveEscape(parent)}' in parents and trashed=false`,fields:"files(id,name,mimeType)",pageSize:"1000"});
 const result=await jsonResponse(await fetch("https://www.googleapis.com/drive/v3/files?"+query,{headers:{Authorization:`Bearer ${access}`},cache:"no-store",signal:AbortSignal.timeout(20000)}),"folder");
 return Array.isArray(result.files)?result.files as {id:string;name:string;mimeType:string}[]:[];
}
export async function findGoogleJobFolder(access:string,parent:string,jobId:string):Promise<string|null> {
 if(!driveFolderUrl(parent)||!/^[A-Za-z0-9_-]+$/.test(jobId))throw new Error("Invalid backup identity");
 const query=new URLSearchParams({q:`'${driveEscape(parent)}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and appProperties has { key='sellerctrlJob' and value='${jobId}' }`,fields:"files(id)",pageSize:"1"});
 const result=await jsonResponse(await fetch("https://www.googleapis.com/drive/v3/files?"+query,{headers:{Authorization:`Bearer ${access}`},cache:"no-store",signal:AbortSignal.timeout(20000)}),"folder");
 const file=(result.files as {id?:string}[]|undefined)?.[0];return file?.id&&driveFolderUrl(file.id)?file.id:null;
}
/** Retention is limited to the exact managed job folder; never the root or legacy files. */
export async function trashGoogleJobFolder(access:string,id:string,jobId:string,parent:string) {
 if(id===parent||!driveFolderUrl(id))throw new Error("Invalid retained folder");
 const headers={Authorization:`Bearer ${access}`,"Content-Type":"application/json"};
 const metadata=await jsonResponse(await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=mimeType,parents,appProperties,trashed`,{headers,signal:AbortSignal.timeout(20000)}),"folder");
 if(metadata.mimeType!=="application/vnd.google-apps.folder"||!(metadata.parents as string[]|undefined)?.includes(parent)||(metadata.appProperties as Record<string,string>|undefined)?.sellerctrlJob!==jobId)throw new Error("Unmanaged folder retention denied");
 if(metadata.trashed===true)return;
 await jsonResponse(await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`,{method:"PATCH",headers,body:JSON.stringify({trashed:true}),signal:AbortSignal.timeout(20000)}),"folder");
}
