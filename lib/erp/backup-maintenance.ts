import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations, organizationBackupHealth } from "@/db/schema";
import { withOrgScope, withPlatformScope } from "@/lib/db-scope";
import { backupOrgToStorage, pruneBackups } from "./backup";
import { log } from "@/lib/log";

export async function runDailyBackup(orgId: string) {
  try {
  const [org] = await withPlatformScope(() => db.select({name:organizations.nameAr}).from(organizations).where(eq(organizations.id,orgId)).limit(1));
  if (!org) return;
    const [previous] = await withOrgScope(orgId,false, () => db.select().from(organizationBackupHealth).where(eq(organizationBackupHealth.organizationId,orgId)).limit(1));
    await withOrgScope(orgId,false, () => db.insert(organizationBackupHealth).values({organizationId:orgId,status:"RUNNING"}).onConflictDoUpdate({target:organizationBackupHealth.organizationId,set:{status:"RUNNING",lastAttemptAt:new Date()}}));
    // A pruning failure should retry pruning without making another full snapshot.
    if (!previous?.lastSuccessAt || Date.now()-previous.lastSuccessAt.getTime()>60*60_000) {
      await backupOrgToStorage(orgId,org.name);
      await withOrgScope(orgId,false,()=>db.update(organizationBackupHealth).set({lastSuccessAt:new Date()}).where(eq(organizationBackupHealth.organizationId,orgId)));
    }
    await withOrgScope(orgId,false,()=>pruneBackups(orgId,14));
    await withOrgScope(orgId,false,()=>db.update(organizationBackupHealth).set({status:"OK"}).where(eq(organizationBackupHealth.organizationId,orgId)));
  } catch {
    try { await withOrgScope(orgId,false,()=>db.insert(organizationBackupHealth).values({organizationId:orgId,status:"FAILED",lastFailureAt:new Date()}).onConflictDoUpdate({target:organizationBackupHealth.organizationId,set:{status:"FAILED",lastFailureAt:new Date()}})); } catch { /* Alert and retry even if status persistence failed. */ }
    log.error("maintenance.backup_failed",{orgId,reason:"backup_failed"});
    throw new Error("Organization backup failed");
  }
}
