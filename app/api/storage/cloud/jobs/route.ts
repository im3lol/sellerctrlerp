import { authorizeErp } from "@/lib/erp/action-auth";
import { listCloudBackupJobs } from "@/lib/erp/cloud-backup-jobs";
export const dynamic="force-dynamic";
export async function GET() {
 const auth=await authorizeErp("settings.edit");
 if("error" in auth)return Response.json({error:"denied"},{status:403});
 return Response.json({jobs:await listCloudBackupJobs(auth.orgId)},{headers:{"cache-control":"private, no-store"}});
}
