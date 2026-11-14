import "server-only";
import { gunzipSync } from "node:zlib";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, storageCloudConnections as connections, storageCloudJobs as jobs } from "@/db/schema";
import { withOrgScope, withPlatformScope } from "@/lib/db-scope";
import { decryptSecret } from "@/lib/crypto";
import { putObject, readPrivateObject, deleteObject } from "@/lib/storage";
import { enqueue, QUEUES } from "@/lib/queue/queues";
import { redisEnabled } from "@/lib/queue/redis";
import { log } from "@/lib/log";
import { tryRecordAudit } from "./audit";
import { exportOrgData } from "./backup";
import { buildBackupSheets, backupFolderName } from "./backup-workbook";
import { cloudConnection, refreshGoogleToken, createGoogleBackupFolder, uploadGoogleBackup, uploadGoogleWorkbook, listGoogleBackupChildren, findGoogleJobFolder, trashGoogleJobFolder } from "./storage-cloud";
import { cairoDay, dailyCloudBackupDue } from "./backup-date";
import { driveFailure } from "./storage-cloud-errors";

const ACTIVE = ["QUEUED","RUNNING","RETRYING"];
const inOrg = <T>(orgId: string, fn: () => Promise<T>) => withOrgScope(orgId,false,fn);
const jobWhere = (orgId:string,id:string) => and(eq(jobs.organizationId,orgId),eq(jobs.id,id));
const change = (orgId:string,id:string,value:Partial<typeof jobs.$inferInsert>) => inOrg(orgId,()=>db.update(jobs).set({...value,updatedAt:new Date()}).where(jobWhere(orgId,id)));

export async function dispatchCloudBackup(orgId:string,id:string) {
 let timer:ReturnType<typeof setTimeout>|undefined;
 try { return await Promise.race([enqueue(QUEUES.cloudBackup,{orgId,provider:"google-drive",cloudBackupJobId:id},{jobId:`cloud-${id}`,attempts:3,backoff:{type:"exponential",delay:15000},removeOnComplete:true,removeOnFail:true}),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error("Queue unavailable")),5000);})]); } finally {if(timer)clearTimeout(timer); }
}

/** Authorization belongs to the caller. No credentials or snapshot bytes enter Redis. */
export async function requestCloudBackup(orgId:string,userId:string|null,locale:"ar"|"en",resumeId?:string,scheduledDate?:string) {
 if(!redisEnabled()) throw new Error("queue");
 const connection=await cloudConnection(orgId);if(!connection)throw new Error("connect");
 const task=await inOrg(orgId,async()=>{
  const [active]=await db.select().from(jobs).where(and(eq(jobs.organizationId,orgId),inArray(jobs.status,ACTIVE))).limit(1);
  if(active)return active;
  if(resumeId){
   const [old]=await db.select().from(jobs).where(jobWhere(orgId,resumeId)).limit(1);
   if(!old||old.status!=="FAILED"||old.connectionId!==connection.id||old.rootFolderId!==connection.folderId)throw new Error("connect");
   const [resumed]=await db.update(jobs).set({status:"QUEUED",errorCode:null,finishedAt:null,updatedAt:new Date()}).where(and(jobWhere(orgId,resumeId),eq(jobs.status,"FAILED"))).returning();
   if(!resumed)throw new Error("queue");return resumed;
  }
  const [created]=await db.insert(jobs).values({organizationId:orgId,connectionId:connection.id,rootFolderId:connection.folderId,userId,locale,scheduledDate}).onConflictDoNothing().returning();
  if(created)return created;
  const [winner]=await db.select().from(jobs).where(and(eq(jobs.organizationId,orgId),inArray(jobs.status,ACTIVE))).limit(1);
  if(!winner)throw new Error("queue");return winner;
 });
 try { await dispatchCloudBackup(orgId,task.id); } catch { log.error("cloud_backup.dispatch_failed",{orgId,jobId:task.id}); /* Durable queued row is recovered by the scheduler. */ }
 return task.id;
}

export async function listCloudBackupJobs(orgId:string) {
 return inOrg(orgId,()=>db.select({id:jobs.id,status:jobs.status,completedFiles:jobs.completedFiles,totalFiles:jobs.totalFiles,errorCode:jobs.errorCode,folderId:jobs.folderId,createdAt:jobs.createdAt,finishedAt:jobs.finishedAt,prunedAt:jobs.prunedAt}).from(jobs).where(eq(jobs.organizationId,orgId)).orderBy(desc(jobs.createdAt)).limit(20));
}

export async function runCloudBackup(orgId:string,id:string,lastAttempt=false) {
 const [task]=await inOrg(orgId,()=>db.select().from(jobs).where(jobWhere(orgId,id)).limit(1));
 if(!task||task.status==="COMPLETED"||task.prunedAt)return;
 let stage="token";
 try {
  const connection=await cloudConnection(orgId);
  if(!connection||connection.id!==task.connectionId||connection.folderId!==task.rootFolderId)throw new Error("Disconnected");
  const refresh=decryptSecret(connection.refreshToken);if(!refresh)throw new Error("Disconnected");
  await change(orgId,id,{status:"RUNNING",attempts:task.attempts+1,errorCode:null});
  const access=await refreshGoogleToken(refresh);
  stage="snapshot";
  const key=`cloud-backups/${orgId}/${id}/snapshot.json.gz`;
  let buffer:Buffer;
  if(task.snapshotKey){if(task.snapshotKey!==key)throw new Error("Invalid snapshot key");buffer=await readPrivateObject(key);}
  else {
   const [org]=await inOrg(orgId,()=>db.select({name:organizations.nameAr}).from(organizations).where(eq(organizations.id,orgId)).limit(1));
   const backup=await exportOrgData(orgId,org?.name||"Company");buffer=backup.buffer;
   await putObject(key,buffer,"application/gzip",{private:true});await change(orgId,id,{snapshotKey:key});
  }
  const workbook=buildBackupSheets(buffer,orgId,task.locale==="en"?"en":"ar");
  const meta=JSON.parse(gunzipSync(buffer).toString("utf8")).meta;
  const filename=`backup-${orgId}-${new Date(meta.exportedAt).toISOString().slice(0,19).replace(/[:T]/g,"-")}.json.gz`;
  await change(orgId,id,{totalFiles:workbook.files.length+1});
  stage="folder";
  const folder=task.folderId||await findGoogleJobFolder(access,connection.folderId,id)||await createGoogleBackupFolder(access,connection.folderId,backupFolderName(meta.exportedAt),id);
  await change(orgId,id,{folderId:folder});
  const current=await listGoogleBackupChildren(access,folder);
  const json=current.find(f=>f.name===filename&&f.mimeType==="application/gzip");
  stage="upload";
  const jsonId=json?.id||await uploadGoogleBackup(access,folder,filename,buffer);
  const ids:Record<string,string>=Object.fromEntries(workbook.files.flatMap(file=>{const found=current.find(f=>f.name===file.name&&f.mimeType==="application/vnd.google-apps.spreadsheet");return found?[[file.name,found.id]]:[];}));
  await change(orgId,id,{jsonFileId:jsonId,sheetIds:{...ids},completedFiles:Object.keys(ids).length+1});
  for(const file of workbook.files){
   if(ids[file.name])continue;
   const stillConnected=await cloudConnection(orgId);
   if(!stillConnected||stillConnected.id!==task.connectionId||stillConnected.folderId!==task.rootFolderId)throw new Error("Disconnected");
   ids[file.name]=current.find(f=>f.name===file.name&&f.mimeType==="application/vnd.google-apps.spreadsheet")?.id||await uploadGoogleWorkbook(access,folder,`${file.name}.xlsx`,file.buffer);
   await change(orgId,id,{sheetIds:{...ids},completedFiles:Object.keys(ids).length+1});
  }
  await inOrg(orgId,async()=>{
   const [connected]=await db.select({id:connections.id}).from(connections).where(and(eq(connections.organizationId,orgId),eq(connections.id,task.connectionId),eq(connections.folderId,task.rootFolderId))).limit(1);
   if(!connected)throw new Error("Disconnected");
   await db.update(jobs).set({status:"COMPLETED",errorCode:null,finishedAt:new Date(),updatedAt:new Date()}).where(jobWhere(orgId,id));
   await db.update(connections).set({lastBackupAt:new Date()}).where(and(eq(connections.organizationId,orgId),eq(connections.id,task.connectionId)));
   await tryRecordAudit({orgId,userId:task.userId,action:"CREATE",entityType:"CLOUD_BACKUP",entityId:id,summary:"حفظ نسخة بيانات المؤسسة على Google Drive",metadata:{snapshotFolderId:folder,jsonFileId:jsonId,files:workbook.files.length+1}});
  });
  if(connection.retainCopies>0)await pruneCloudBackups(orgId,access,connection.id,connection.folderId,connection.retainCopies).catch(()=>log.error("cloud_backup.retention_failed",{orgId,jobId:id}));
 } catch(error) {
  const failure=error instanceof Error&&error.message==="Disconnected"?{code:"reconnect",diagnostic:{stage,reason:"disconnected"}}:driveFailure(error,stage);
  await change(orgId,id,{status:lastAttempt?"FAILED":"RETRYING",errorCode:failure.code,...(lastAttempt?{finishedAt:new Date()}:{})}).catch(()=>{});
  if(lastAttempt)log.error("cloud_backup.failed",{orgId,jobId:id,...failure.diagnostic});
  throw new Error(`Cloud backup ${failure.code}`);
 }
}

async function pruneCloudBackups(orgId:string,access:string,connectionId:string,root:string,keep:number) {
 const completed=await inOrg(orgId,()=>db.select().from(jobs).where(and(eq(jobs.organizationId,orgId),eq(jobs.connectionId,connectionId),eq(jobs.rootFolderId,root),eq(jobs.status,"COMPLETED"),isNull(jobs.prunedAt))).orderBy(desc(jobs.createdAt)));
 for(const old of completed.slice(keep)){
  if(!old.folderId)continue;
  await trashGoogleJobFolder(access,old.folderId,old.id,root);
  if(old.snapshotKey===`cloud-backups/${orgId}/${old.id}/snapshot.json.gz`)await deleteObject(old.snapshotKey,{private:true});
  await change(orgId,old.id,{prunedAt:new Date()});
 }
}

/** Opt-in schedules and recovery of durable tasks if Redis was restarted. */
let scheduling=false;
export async function scheduleCloudBackups(now=new Date()) {
 if(scheduling)return;
 scheduling=true;
 try {
 const all=await withPlatformScope(()=>db.select().from(connections).where(eq(connections.provider,"google-drive")));
 for(const connection of all){
  const orgId=connection.organizationId;
  const active=await inOrg(orgId,()=>db.select({id:jobs.id}).from(jobs).where(and(eq(jobs.organizationId,orgId),inArray(jobs.status,ACTIVE))));
  for(const job of active)await dispatchCloudBackup(orgId,job.id);
  if(!connection.dailyBackup||active.length)continue;
  const [latest]=await inOrg(orgId,()=>db.select({createdAt:jobs.createdAt}).from(jobs).where(eq(jobs.organizationId,orgId)).orderBy(desc(jobs.createdAt)).limit(1));
  if(!dailyCloudBackupDue(connection.dailyBackup,latest?.createdAt??null,now))continue;
  await requestCloudBackup(orgId,null,"ar",undefined,cairoDay(now));
 }
 }finally{scheduling=false;}
}
