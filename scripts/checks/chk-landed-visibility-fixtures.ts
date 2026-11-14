/** Visibility lifecycle scenarios in the disposable clone only. Never posts accounting entries. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq,and,inArray } from 'drizzle-orm';
import { db,pool } from '@/lib/db';
import { items,warehouses,suppliers,purchaseReceipts,purchaseReceiptLines,landedCostVouchers,landedCostVoucherLines } from '@/db/schema';
import { withOrgScope } from '@/lib/db-scope';
import { runWithErpContext } from '@/lib/erp/erp-context';
import { getLandedCostReceiptsAction,getLandedCostBasisAction } from '@/app/actions/erp/landed-costs';
import { hasPriorLandedCost } from '@/lib/erp/landed-cost-visibility';
const orgId='33c16650-d2b8-4717-a902-4770d15aa217';
async function main(){
 assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/sellerctrl_landed_test_audit_20261024');
 let rid='',vid='';const scope=<T>(f:()=>Promise<T>)=>withOrgScope(orgId,false,f);
 try{
 const f=await scope(async()=>{
 const its=await db.select().from(items).where(eq(items.organizationId,orgId)).limit(2);assert(its.length===2);
 const [wh]=await db.select().from(warehouses).where(eq(warehouses.organizationId,orgId)).limit(1);
 const [sup]=await db.select().from(suppliers).where(eq(suppliers.organizationId,orgId)).limit(1);assert(wh&&sup);
 const suffix=randomUUID();const [r]=await db.insert(purchaseReceipts).values({organizationId:orgId,number:'VIS-'+suffix,supplierId:sup.id,warehouseId:wh.id,date:new Date(),status:'RECEIVED'}).returning();rid=r.id;
 await db.insert(purchaseReceiptLines).values(its.map(i=>({organizationId:orgId,purchaseReceiptId:rid,itemId:i.id,quantity:'2'})));
 const [v]=await db.insert(landedCostVouchers).values({organizationId:orgId,number:'VIS-'+suffix,supplierId:sup.id,date:new Date()}).returning();vid=v.id;
 return{its,wh};});
 await runWithErpContext({orgId,userId:'visibility-fixture',role:'system_admin',permissions:new Set(['purchases.view'])},async()=>{
 const state=async(expected:boolean,costed:number)=>{const list=await getLandedCostReceiptsAction();assert(list.ok,list.error);assert.equal(list.receipts?.find(r=>r.id===rid)?.fullyCosted,expected);const b=await getLandedCostBasisAction([rid]);assert(b.ok,b.error);assert.equal(b.lines?.filter(l=>hasPriorLandedCost(l)).length,costed);};
 await state(false,0);
 const add=async(index:number,amount:string)=>scope(()=>db.insert(landedCostVoucherLines).values({organizationId:orgId,voucherId:vid,purchaseReceiptId:rid,itemId:f.its[index].id,warehouseId:f.wh.id,quantity:'2',allocatedAmount:amount,perUnit:String(Number(amount)/2)}));
 await add(0,'20');await state(false,1); // partial receipt remains available
 await add(1,'0');await state(false,1); // zero allocation does not hide an untouched product
 await scope(()=>db.update(landedCostVoucherLines).set({allocatedAmount:'10',perUnit:'5'}).where(and(eq(landedCostVoucherLines.voucherId,vid),eq(landedCostVoucherLines.itemId,f.its[1].id))));await state(true,2);
 await scope(()=>db.update(landedCostVouchers).set({status:'POSTED'}).where(eq(landedCostVouchers.id,vid)));await state(true,2);
 await scope(()=>db.update(landedCostVouchers).set({status:'CANCELLED'}).where(eq(landedCostVouchers.id,vid)));await state(false,0);
 await scope(()=>db.update(purchaseReceiptLines).set({shippingPerUnit:'3'}).where(and(eq(purchaseReceiptLines.purchaseReceiptId,rid),eq(purchaseReceiptLines.itemId,f.its[0].id))));await state(false,1);
 await scope(()=>db.insert(purchaseReceiptLines).values({organizationId:orgId,purchaseReceiptId:rid,itemId:f.its[0].id,quantity:'1',shippingPerUnit:'0'}));await state(false,1); // duplicate grouped row
 await scope(()=>db.update(purchaseReceiptLines).set({shippingPerUnit:'4'}).where(and(eq(purchaseReceiptLines.purchaseReceiptId,rid),eq(purchaseReceiptLines.itemId,f.its[1].id))));await state(true,2);
 console.log('PASS 9 scenarios: untouched, partial, zero, draft, posted, cancelled, embedded freight and duplicate grouped receipt rows.');
 });
 }finally{
 await scope(async()=>{if(vid)await db.delete(landedCostVouchers).where(eq(landedCostVouchers.id,vid));if(rid)await db.delete(purchaseReceipts).where(eq(purchaseReceipts.id,rid));});await pool.end();
 }
}main().catch(e=>{console.error(e);process.exitCode=1;});
