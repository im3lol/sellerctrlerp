import {beforeEach,expect,it,vi} from "vitest";
import {gzipSync} from "node:zlib";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({task:{} as Record<string,unknown>,scope:"",scopes:[] as string[],successUpdates:0,export:vi.fn(),read:vi.fn(),put:vi.fn(),build:vi.fn(),connection:vi.fn(),folder:vi.fn(),json:vi.fn(),sheet:vi.fn(),alert:vi.fn(),files:[] as {id:string;name:string;mimeType:string}[]}));
vi.mock("@/db/schema",()=>({organizations:{tag:"org"},storageCloudConnections:{tag:"connection"},storageCloudJobs:{tag:"job"}}));
vi.mock("@/lib/db-scope",()=>({withOrgScope:async(org:string,_admin:boolean,fn:()=>Promise<unknown>)=>{const before=m.scope;m.scope=org;m.scopes.push(org);try{return await fn();}finally{m.scope=before;}},withPlatformScope:async(fn:()=>unknown)=>fn()}));
vi.mock("@/lib/db",()=>({db:{select:()=>({from:(table:{tag:string})=>{const rows=()=>m.scope!=="own"?[]:table.tag==="org"?[{name:"Company"}]:table.tag==="connection"?[{id:"connection"}]:[{...m.task}];const q={where:()=>q,limit:async()=>rows(),orderBy:async()=>rows(),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(rows()).then(resolve)};return q;}}),update:(table:{tag:string})=>({set:(value:Record<string,unknown>)=>({where:async()=>{if(table.tag==="job")Object.assign(m.task,value);else m.successUpdates++;return[];}})})}}));
vi.mock("@/lib/crypto",()=>({decryptSecret:()=>"refresh"}));
vi.mock("@/lib/storage",()=>({putObject:m.put,readPrivateObject:m.read,deleteObject:vi.fn()}));
vi.mock("@/lib/queue/queues",()=>({enqueue:vi.fn(),QUEUES:{cloudBackup:"cloud-backup"}}));
vi.mock("@/lib/queue/redis",()=>({redisEnabled:()=>true}));
vi.mock("@/lib/log",()=>({log:{error:m.alert}}));
vi.mock("../audit",()=>({tryRecordAudit:vi.fn()}));
vi.mock("../backup",()=>({exportOrgData:m.export}));
vi.mock("../backup-workbook",()=>({buildBackupSheets:m.build,backupFolderName:()=>"2026-11-14 20-00-00"}));
vi.mock("../storage-cloud",()=>({cloudConnection:m.connection,refreshGoogleToken:async()=>"access",createGoogleBackupFolder:m.folder,findGoogleJobFolder:async()=>null,listGoogleBackupChildren:async()=>m.files,uploadGoogleBackup:m.json,uploadGoogleWorkbook:m.sheet,trashGoogleJobFolder:vi.fn()}));
import {runCloudBackup} from "../cloud-backup-jobs";
const snapshot=gzipSync(JSON.stringify({meta:{orgId:"own",exportedAt:"2026-11-14T18:00:00Z"},data:{}}));
beforeEach(()=>{
 vi.clearAllMocks();m.task={id:"job",organizationId:"own",connectionId:"connection",rootFolderId:"root",status:"QUEUED",attempts:0,locale:"ar"};m.files=[];m.scope="";m.scopes=[];m.successUpdates=0;
 m.connection.mockResolvedValue({id:"connection",folderId:"root",refreshToken:"encrypted",retainCopies:0});m.folder.mockResolvedValue("dated-folder");
 m.export.mockResolvedValue({buffer:snapshot});m.read.mockResolvedValue(snapshot);m.build.mockReturnValue({files:[{name:"A",buffer:Buffer.from("A")},{name:"B",buffer:Buffer.from("B")}],sheetCount:2});
 m.json.mockImplementation(async(_token,_folder,name)=>{m.files.push({name,id:"json",mimeType:"application/gzip"});return"json";});
 m.sheet.mockImplementation(async(_token,_folder,name)=>{m.files.push({name:name.replace(/\.xlsx$/,""),id:name,mimeType:"application/vnd.google-apps.spreadsheet"});return name;});
});
it("resumes the same immutable snapshot and folder, without duplicating uploaded files",async()=>{
 let failed=false;m.sheet.mockImplementation(async(_token,_folder,name)=>{if(name==="B.xlsx"&&!failed){failed=true;throw new TypeError("PRIVATE-DETAIL");}m.files.push({name:name.replace(/\.xlsx$/,""),id:name,mimeType:"application/vnd.google-apps.spreadsheet"});return name;});
 await expect(runCloudBackup("own","job",false)).rejects.toThrow("temporary");expect(m.task.status).toBe("RETRYING");expect(m.task.completedFiles).toBe(2);expect(m.successUpdates).toBe(0);
 await runCloudBackup("own","job",true);
 expect(m.task.status).toBe("COMPLETED");expect(m.task.completedFiles).toBe(3);expect(m.export).toHaveBeenCalledOnce();expect(m.read).toHaveBeenCalledOnce();expect(m.folder).toHaveBeenCalledOnce();expect(m.json).toHaveBeenCalledOnce();expect(m.sheet.mock.calls.map(c=>c[2])).toEqual(["A.xlsx","B.xlsx","B.xlsx"]);expect(m.successUpdates).toBe(1);
 expect(m.build.mock.calls.map(c=>c[0])).toEqual([snapshot,snapshot]);expect(m.alert).not.toHaveBeenCalled();
});
it("marks exhausted retries failed and never includes provider credentials in the alert",async()=>{
 m.sheet.mockRejectedValue(new TypeError("PRIVATE-DETAIL"));await expect(runCloudBackup("own","job",true)).rejects.toThrow("temporary");expect(m.task.status).toBe("FAILED");expect(m.task.errorCode).toBe("temporary");expect(m.alert).toHaveBeenCalledOnce();expect(JSON.stringify(m.alert.mock.calls)).not.toContain("PRIVATE");expect(m.successUpdates).toBe(0);
});
it("does not read or upload a job belonging to another organization",async()=>{await runCloudBackup("foreign","job",true);expect(m.export).not.toHaveBeenCalled();expect(m.read).not.toHaveBeenCalled();expect(m.folder).not.toHaveBeenCalled();});
it("refuses snapshots outside the job's private storage prefix",async()=>{m.task.snapshotKey="cloud-backups/foreign/job/snapshot.json.gz";await expect(runCloudBackup("own","job",true)).rejects.toThrow();expect(m.read).not.toHaveBeenCalled();expect(m.json).not.toHaveBeenCalled();});
it("refuses a job after the Google account or root folder changed",async()=>{m.connection.mockResolvedValue({id:"connection",folderId:"different-account"});await expect(runCloudBackup("own","job",true)).rejects.toThrow("reconnect");expect(m.export).not.toHaveBeenCalled();expect(m.sheet).not.toHaveBeenCalled();});
