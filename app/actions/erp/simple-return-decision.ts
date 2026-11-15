"use server";
import {and,eq}from "drizzle-orm";
import {z}from "zod";
import {db,scopeStore}from "@/lib/db";
import {withOrgScope}from "@/lib/db-scope";
import {authorizeErp}from "@/lib/erp/action-auth";
import {returnWorkflowCases as cases,returnWorkflowSettings as settings}from "@/db/schema";
import {executeReturnOperation}from "@/lib/erp/return-workflow/store";
import {applySimpleDecision,type SimpleDecision}from "@/lib/erp/return-workflow/simple-decision";
import {recordAudit}from "@/lib/erp/audit";
import {revalidatePath}from "@/lib/safe-revalidate";

const input=z.object({caseId:z.string().min(1),version:z.number().int().positive(),key:z.string().uuid(),itemId:z.string().min(1),
 action:z.enum(["WAITING","SELLABLE","DAMAGED","CLAIM","COMPENSATED","CLOSED_LOSS"]),quantity:z.string().regex(/^\d+(?:\.\d{1,4})?$/).max(25),
 warehouseId:z.string().optional(),invoiceLineId:z.string().optional(),location:z.enum(["LOCAL","AMAZON"]),note:z.string().trim().max(3000),
 reference:z.string().trim().max(200).optional(),amount:z.string().regex(/^\d+(?:\.\d{1,4})?$/).optional(),claimId:z.string().optional(),confirmed:z.boolean(),activatePosting:z.boolean()});
export async function saveSimpleReturnDecisionAction(raw:unknown){
 const parsed=input.safeParse(raw);if(!parsed.success)return {error:"راجع المنتج والكمية وبيانات القرار"};
 const d=parsed.data;
 const auth=await authorizeErp(d.action==="COMPENSATED"?"accounting.post":["SELLABLE","DAMAGED"].includes(d.action)?"inventory.confirm":d.action==="CLOSED_LOSS"?"approvals.decide":"sales.confirm","marketplace");
 if("error"in auth)return auth;
 for(const p of d.action==="DAMAGED"?["accounting.post"as const]:d.action==="CLOSED_LOSS"?["accounting.post"as const,"inventory.confirm"as const]:[]){const extra=await authorizeErp(p,"marketplace");if("error"in extra)return extra;}
 const writes=["SELLABLE","DAMAGED","CLOSED_LOSS","COMPENSATED"].includes(d.action);
 let activation=false;
 if(writes&&d.activatePosting){
  const manager=await authorizeErp("settings.edit","marketplace"),approval=await authorizeErp("approvals.decide","marketplace");
  if("error"in manager||"error"in approval)return {error:"مسؤول المؤسسة فقط يمكنه تفعيل تنفيذ قرارات المرتجعات"};activation=true;
 }
 try{
  const result=await withOrgScope(auth.orgId,false,async()=>{
   const [record]=await db.select().from(cases).where(and(eq(cases.organizationId,auth.orgId),eq(cases.id,d.caseId))).for("update");
   if(!record)throw new Error("المرتجع غير موجود");
   if(writes&&!d.confirmed)throw new Error("أكد الكمية والقرار قبل التنفيذ");
   if(writes){
    const [config]=await db.select().from(settings).where(eq(settings.organizationId,auth.orgId)).for("update");
    if(config?.mode!=="MANUAL"){
     if(!activation||config?.mode!=="MONITOR")throw new Error("أكد تفعيل تنفيذ القرارات لهذا المرتجع؛ لن تتم تسوية البيانات القديمة تلقائيًا");
     await db.update(settings).set({mode:"MANUAL",cutoverAt:config.cutoverAt??new Date(),updatedBy:auth.userId,updatedAt:new Date()}).where(eq(settings.organizationId,auth.orgId));
     await recordAudit(scopeStore.getStore()!.tx,{orgId:auth.orgId,userId:auth.userId,action:"UPDATE",entityType:"RETURN_WORKFLOW",entityId:auth.orgId,summary:"Manual return decisions enabled by confirmed operator action"});
    }
   }
   const kind=d.action==="COMPENSATED"?"REIMBURSEMENT"as const:["SELLABLE","DAMAGED","CLOSED_LOSS"].includes(d.action)?"RECEIPT"as const:d.action==="CLAIM"?"CLAIM"as const:"MATCH"as const;
   const payload:Record<string,unknown>={...d,simpleAction:d.action};
   let pendingCompensation=false;
   const result=await executeReturnOperation({orgId:auth.orgId,userId:auth.userId,caseId:d.caseId,key:d.key,version:d.version,kind,payload},async(r,id)=>{
    const applied=await applySimpleDecision(auth.orgId,auth.userId,r,d as SimpleDecision,id);
    Object.assign(payload,applied.canonical);pendingCompensation=applied.pendingCompensation;return applied;
   });
   return {...result,pendingCompensation};
  });
  revalidatePath("/sales/marketplace-returns");return {ok:true,...result};
 }catch(error){
  const message=error instanceof Error?error.message:"";
  if(/[\u0600-\u06ff]/.test(message))return {error:message};
  if(/changed|reused/i.test(message))return {error:"بيانات المرتجع اتحدثت؛ حدّث الصفحة ثم راجع القرار"};
  if(/exception|revised/i.test(message))return {error:"وصلت معلومات جديدة من أمازون؛ راجعها قبل تأكيد حالة المرتجع"};
  if(/Historical|current.*source|observation-only/i.test(message))return {error:"هذا المصدر قديم ويحتاج مراجعة قبل تسجيل أثر جديد؛ لم تتغير الأرصدة"};
  if(/allocated|already|exceeds|twice|remaining/i.test(message))return {error:"الكمية أو التعويض مسجّلان بالفعل أو يتجاوزان المتبقي؛ لم يُكرر التسجيل"};
  return {error:"القرار يحتاج مراجعة أصل الحركة أو التكلفة؛ لم تتغير الأرصدة"};
 }
}
