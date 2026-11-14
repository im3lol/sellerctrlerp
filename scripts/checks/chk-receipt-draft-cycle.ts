/** Real draft/edit/confirm regression. All writes are guarded to the disposable clone. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {and,eq,inArray,sql} from 'drizzle-orm';
import {db,pool} from '@/lib/db';
import * as S from '@/db/schema';
import {withOrgScope,withPlatformScope} from '@/lib/db-scope';
import {runWithErpContext} from '@/lib/erp/erp-context';
import {initializeAccountingForOrg} from '@/lib/erp/default-chart';
import {createReceiptFromOrderAction,getReceiptDraftAction,updateReceiptDraftAction,confirmReceiptAction,getReceivableOrderLinesAction,deleteReceiptAction} from '@/app/actions/erp/goods-receipts';
import {saveReceiptSerialsAction} from '@/app/actions/erp/serials';
import type {ErpPermission} from '@/lib/erp/permissions';
const orgId='33c16650-d2b8-4717-a902-4770d15aa217';
async function main(){
 assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/sellerctrl_landed_test_audit_20261024');
 let checks=0;const check=(ok:unknown,name:string)=>{assert(ok,name);checks++;console.log('PASS '+name);};
 try{
 const [user]=await withPlatformScope(()=>db.select().from(S.users).where(eq(S.users.role,'system_admin')).limit(1));assert(user);
 const context={orgId,userId:user.id,role:'system_admin',permissions:new Set<ErpPermission>(['purchases.receive','purchases.view','purchases.confirm'])};
 const run=<T>(fn:()=>Promise<T>)=>runWithErpContext(context,fn),scope=<T>(fn:()=>Promise<T>)=>withOrgScope(orgId,false,fn);
 const [photo]=await withPlatformScope(()=>db.select({image:S.items.image}).from(S.items).where(sql`${S.items.image} is not null`).limit(1));
 const f=await scope(async()=>{
 await initializeAccountingForOrg(orgId);
 const [sup]=await db.select().from(S.suppliers).where(eq(S.suppliers.organizationId,orgId)).limit(1);assert(sup);
 const suffix=randomUUID().slice(0,8);
 const [wh1,wh2]=await db.insert(S.warehouses).values([1,2].map(n=>({organizationId:orgId,code:`QA-GRN-${suffix}-${n}`,nameAr:`QA receiving ${n}`}))).returning();
 const [a,b,c]=await db.insert(S.items).values([
 {organizationId:orgId,code:`QA-R-A-${suffix}`,nameAr:'QA receiving item A with a complete product name for checking readable rows',image:photo?.image},
 {organizationId:orgId,code:`QA-R-B-${suffix}`,nameAr:'QA perishable receiving item B',isPerishable:true,shelfLifeDays:null,image:photo?.image},
 {organizationId:orgId,code:`QA-R-C-${suffix}`,nameAr:'QA serial receiving item C',tracking:'SERIAL',image:photo?.image},
 ]).returning();
 const [po]=await db.insert(S.purchaseOrders).values({organizationId:orgId,number:`PO-QA-RECEIPT-${suffix}`,date:new Date('2026-10-24'),status:'CONFIRMED',supplierId:sup.id,warehouseId:wh1.id,currencyCode:'USD',exchangeRate:'50',rateSource:'MANUAL'}).returning();
 await db.insert(S.purchaseOrderLines).values([{itemId:a.id,quantity:'10',unitPrice:'100',shippingPerUnit:'2'},{itemId:b.id,quantity:'8',unitPrice:'50'},{itemId:c.id,quantity:'3',unitPrice:'200'}].map(l=>({...l,purchaseOrderId:po.id,totalAmount:String(Number(l.quantity)*Number(l.unitPrice))})));
 return{po,sup,wh1,wh2,a,b,c};});
 check(!(await run(()=>createReceiptFromOrderAction(f.po.id,[{itemId:f.a.id,quantity:-1}], '2026-10-24'))).ok,'negative quantities cannot create a receipt');
 check(!(await run(()=>createReceiptFromOrderAction(f.po.id,[{itemId:f.a.id,quantity:0.00001}], '2026-10-24'))).ok,'excess precision cannot silently create a zero-quantity line');
 check(!(await run(()=>createReceiptFromOrderAction(f.po.id,[{itemId:f.a.id,quantity:1},{itemId:f.a.id,quantity:1}], '2026-10-24'))).ok,'duplicate selected items cannot be received twice');
 check(!(await run(()=>createReceiptFromOrderAction(f.po.id,[{itemId:f.a.id,quantity:1}], '2026-02-30'))).ok,'impossible receipt dates cannot be saved');
 const created=await run(()=>createReceiptFromOrderAction(f.po.id,[{itemId:f.a.id,quantity:3}], '2026-10-24','Initial draft'));assert(created.id&&created.ok,created.error);const rid=created.id;
 const effects=async(id:string)=>scope(async()=>{const [s]=await db.select({n:sql<number>`count(*)::int`}).from(S.stockMovements).where(eq(S.stockMovements.referenceId,id));const [j]=await db.select({n:sql<number>`count(*)::int`}).from(S.journalEntries).where(eq(S.journalEntries.sourceId,id));return{s:s.n,j:j.n};});
 assert.deepEqual(await effects(rid),{s:0,j:0});let d=await run(()=>getReceiptDraftAction(rid));assert(d.initial);check(d.initial.lines.length===1&&d.initial.lines[0].itemId===f.a.id,'only selected items enter the draft; saving has no stock or GL effect');
 const [before]=await scope(()=>db.select().from(S.purchaseReceiptLines).where(eq(S.purchaseReceiptLines.purchaseReceiptId,rid)));
 await scope(()=>db.update(S.purchaseReceiptLines).set({taxPerUnit:'0.7'}).where(eq(S.purchaseReceiptLines.id,before.id)));
 const input={picks:[{itemId:f.a.id,quantity:2.5,warehouseId:f.wh2.id},{itemId:f.b.id,quantity:1,warehouseId:f.wh1.id,expiryDate:'2027-10-24',batchNo:'BATCH-QA'}],date:'2026-10-25',notes:'Edited receipt draft',expectedUpdatedAt:d.initial.updatedAt};
 const saved=await run(()=>updateReceiptDraftAction(rid,input));assert(saved.ok,saved.error);
 const [after]=await scope(()=>db.select().from(S.purchaseReceiptLines).where(eq(S.purchaseReceiptLines.id,before.id)));check(after&&Number(after.quantity)===2.5&&after.taxPerUnit==='0.700000'&&Number(after.shippingPerUnit)===2,'edit retains line identity, freight and historical VAT snapshot');
 d=await run(()=>getReceiptDraftAction(rid));assert(d.initial);check(d.initial.lines.length===2&&d.initial.date==='2026-10-25'&&d.initial.notes==='Edited receipt draft','edit adds selected order items, stores lots/expiry/date/notes and keeps the same receipt');
 assert.deepEqual(await effects(rid),{s:0,j:0});check(!(await run(()=>updateReceiptDraftAction(rid,input))).ok,'stale editor is rejected');
 const edit=(picks:typeof input.picks,token=d.initial!.updatedAt)=>run(()=>updateReceiptDraftAction(rid,{...input,picks,expectedUpdatedAt:token}));
 check(!(await edit([{itemId:f.a.id,quantity:99,warehouseId:f.wh1.id}])).ok,'over-receipt rejected');
 check(!(await edit([{itemId:randomUUID(),quantity:1,warehouseId:f.wh1.id}])).ok,'foreign or non-order item rejected');
 check(!(await edit([{itemId:f.a.id,quantity:1,warehouseId:randomUUID()}])).ok,'foreign warehouse rejected');
 check(!(await edit([{itemId:f.b.id,quantity:1,warehouseId:f.wh1.id}])).ok,'selected perishable item requires expiry');
 check(!(await edit([{itemId:f.a.id,quantity:NaN,warehouseId:f.wh1.id}])).ok,'non-finite quantity rejected');
 check(!(await runWithErpContext({...context,permissions:new Set<ErpPermission>(['purchases.view'])},()=>updateReceiptDraftAction(rid,{...input,expectedUpdatedAt:d.initial!.updatedAt}))).ok,'read-only user cannot edit');
 check(!(await runWithErpContext({...context,orgId:randomUUID()},()=>updateReceiptDraftAction(rid,{...input,expectedUpdatedAt:d.initial!.updatedAt}))).ok,'another company cannot edit this draft');
 const simultaneous=await Promise.all([edit(input.picks),edit(input.picks)]);check(simultaneous.filter(r=>r.ok).length===1,'two simultaneous saves using one version cannot overwrite each other');
 d=await run(()=>getReceiptDraftAction(rid));assert(d.initial);
 check((await edit([{itemId:f.a.id,quantity:2.5,warehouseId:f.wh2.id}],d.initial.updatedAt)).ok,'a saved draft item can be excluded without posting');
 d=await run(()=>getReceiptDraftAction(rid));assert(d.initial);check(d.initial.lines.length===1,'excluded draft item is removed from the saved receipt');
 assert((await edit(input.picks,d.initial.updatedAt)).ok);d=await run(()=>getReceiptDraftAction(rid));assert(d.initial);
 const race=await Promise.all([run(()=>confirmReceiptAction(rid)),edit(input.picks,d.initial.updatedAt)]);
 let [posted]=await scope(()=>db.select().from(S.purchaseReceipts).where(eq(S.purchaseReceipts.id,rid)));
 if(posted.status==='DRAFT'){const confirmed=await run(()=>confirmReceiptAction(rid));assert(confirmed.ok,confirmed.error);[posted]=await scope(()=>db.select().from(S.purchaseReceipts).where(eq(S.purchaseReceipts.id,rid)));}
 check(posted.status==='RECEIVED'&&posted.currencyCode==='USD'&&Number(posted.exchangeRate)===50,'confirm/edit race leaves a single valid receipt and preserves currency/rate');
 const moves=await scope(()=>db.select().from(S.stockMovements).where(eq(S.stockMovements.referenceId,rid)));check(moves.length===2&&moves.some(m=>m.itemId===f.a.id&&Number(m.quantity)===2.5&&m.warehouseId===f.wh2.id)&&moves.some(m=>m.itemId===f.b.id&&Number(m.quantity)===1),'confirmation posts exactly the saved selected quantities to their warehouses');
 check(!(await edit(input.picks)).ok,'confirmed receipt cannot be edited');check(!(await run(()=>deleteReceiptAction(rid))).ok,'confirmed receipt cannot be deleted');
 const basis=await run(()=>getReceivableOrderLinesAction(f.po.id));assert(basis.lines);check(basis.lines.find(l=>l.itemId===f.a.id)?.remaining===7.5&&basis.lines.find(l=>l.itemId===f.b.id)?.remaining===7,'unreceived balance remains open on purchase order');
 const tiny=await run(()=>createReceiptFromOrderAction(f.po.id,[{itemId:f.a.id,quantity:0.0001}], '2026-10-24'));assert(tiny.id);const tinyDraft=await run(()=>getReceiptDraftAction(tiny.id!));check(tinyDraft.initial?.lines[0].quantity===0.0001,'four-decimal quantity is not rounded to zero');check((await run(()=>confirmReceiptAction(tiny.id!))).ok,'fractional receipt confirms against fractional remaining quantity');
 const serial=await run(()=>createReceiptFromOrderAction(f.po.id,[{itemId:f.c.id,quantity:1}], '2026-10-24'));assert(serial.id);let sd=await run(()=>getReceiptDraftAction(serial.id!));assert(sd.initial);
 const serialInput={date:'2026-10-25',notes:'Serial draft',expectedUpdatedAt:sd.initial.updatedAt,picks:[{itemId:f.c.id,quantity:2,warehouseId:f.wh2.id}]};
 assert((await run(()=>saveReceiptSerialsAction(serial.id!,[{itemId:f.c.id,serials:['QA-'+randomUUID()]}]))).ok);
 check(!(await run(()=>updateReceiptDraftAction(serial.id!,serialInput))).ok,'serial staging invalidates stale quantity editor');sd=await run(()=>getReceiptDraftAction(serial.id!));assert(sd.initial);
 check((await run(()=>updateReceiptDraftAction(serial.id!,{...serialInput,expectedUpdatedAt:sd.initial!.updatedAt}))).ok,'increasing serial quantity preserves staged serials');
 check(!(await run(()=>confirmReceiptAction(serial.id!))).ok,'missing serials block confirmation after quantity increase');sd=await run(()=>getReceiptDraftAction(serial.id!));assert(sd.initial);
 check(!(await run(()=>updateReceiptDraftAction(serial.id!,{...serialInput,expectedUpdatedAt:sd.initial!.updatedAt,picks:[{itemId:f.a.id,quantity:1,warehouseId:f.wh1.id}]}))).ok,'cannot silently remove an item with staged serials');
 const scan=['QA-'+randomUUID(),'QA-'+randomUUID()];assert((await run(()=>saveReceiptSerialsAction(serial.id!,[{itemId:f.c.id,serials:scan}]))).ok);check((await run(()=>confirmReceiptAction(serial.id!))).ok,'correct serial count allows confirmation after draft edit');
 const ui=await run(()=>createReceiptFromOrderAction(f.po.id,[{itemId:f.a.id,quantity:1}], '2026-10-24'));assert(ui.id);
 await writeFile('.ops-data/receipt-edit-20261024/fixture.json',JSON.stringify({orgId,poId:f.po.id,poNumber:f.po.number,receiptId:ui.id,receiptNumber:ui.number,confirmedNumber:posted.number,wh1:f.wh1.id,wh2:f.wh2.id,a:{id:f.a.id,code:f.a.code},b:{id:f.b.id,code:f.b.code},c:{id:f.c.id,code:f.c.code},checks},null,2));
 console.log(checks+' isolated receipt cycle checks passed; fixtures retained only in clone for browser verification.');
 }finally{await pool.end();}
}main().catch(e=>{console.error(e);process.exitCode=1;});
