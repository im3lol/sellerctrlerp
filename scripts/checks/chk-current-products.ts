/** Database integration: disposable clone only, transaction rolled back. */
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {and,eq,sql} from 'drizzle-orm';import {db,pool} from '@/lib/db';import {withPlatformScope,withOrgScope} from '@/lib/db-scope';import {organizations,items,itemCodes} from '@/db/schema';import {ingestProducts} from '@/lib/erp/marketplace/ingest';
async function run(){assert(new URL(process.env.DATABASE_URL!).pathname.startsWith('/sellerctrl_landed_test_'),'Isolated clone required');
 let orgId='';try{
 const [org]=await withPlatformScope(()=>db.insert(organizations).values({nameAr:'Current products QA',slug:'current-products-'+randomUUID()}).returning());orgId=org.id;
 await withOrgScope(orgId,false,async()=>{
  const p={code:'SKU-ONE',altCode:'ASIN-CURRENT',name:'Current FBA product',sellPrice:100,fnsku:'FNSKU-ONE'};
  const first=await ingestProducts(orgId,[p,{...p,code:'SKU-TWO',fnsku:'FNSKU-TWO'}],'create');assert.equal(first.created,1);
  const list=await db.select().from(items).where(eq(items.organizationId,orgId));assert.equal(list.length,1);
  const codes=await db.select().from(itemCodes).where(eq(itemCodes.organizationId,orgId));assert.equal(codes.length,5);
  const rerun=await ingestProducts(orgId,[p,{...p,code:'SKU-TWO',fnsku:'FNSKU-TWO'}],'create');assert.equal(rerun.created,0);assert.equal(rerun.alreadyLinked,2);
  const second=await ingestProducts(orgId,[{...p,altCode:'ASIN-NEW'}],'create');assert.equal(second.created,1);
  const third=await ingestProducts(orgId,[{...p,altCode:'ASIN-NEW',code:'SKU-TWO'}],'link');assert.equal(third.linked,1);
  const movement=await db.execute(sql`select count(*)::int n from stock_movements where organization_id=${orgId}`);assert.equal(movement.rows[0].n,0);
  console.log('PASS one master per ASIN, all aliases retained, repeat import idempotent, reused SKU linked to current ASIN, zero stock movements');
 });
 }finally{if(orgId)await withPlatformScope(()=>db.delete(organizations).where(eq(organizations.id,orgId)));}}
run().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
