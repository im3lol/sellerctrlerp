/** Read-only check of receipt visibility metadata against the authorized grouped basis. */
import assert from 'node:assert/strict';
import { db,pool } from '@/lib/db';
import { purchaseReceipts } from '@/db/schema';
import { withPlatformScope } from '@/lib/db-scope';
import { runWithErpContext } from '@/lib/erp/erp-context';
import { getLandedCostReceiptsAction,getLandedCostBasisAction } from '@/app/actions/erp/landed-costs';
import { hasPriorLandedCost } from '@/lib/erp/landed-cost-visibility';
async function main(){try{
 const orgs=await withPlatformScope(()=>db.selectDistinct({id:purchaseReceipts.organizationId}).from(purchaseReceipts));
 let full=0,partial=0,untouched=0,total=0;
 for(const org of orgs){await runWithErpContext({orgId:org.id,userId:'visibility-read-check',role:'system_admin',permissions:new Set(['purchases.view'])},async()=>{
 const r=await getLandedCostReceiptsAction();assert(r.ok,r.error);
 for(let i=0;i<(r.receipts?.length??0);i+=200){const chunk=r.receipts!.slice(i,i+200),basis=await getLandedCostBasisAction(chunk.map(r=>r.id));assert(basis.ok,basis.error);
 for(const receipt of chunk){const lines=basis.lines!.filter(l=>l.purchaseReceiptId===receipt.id);const costed=lines.filter(l=>hasPriorLandedCost(l));assert.equal(receipt.fullyCosted,costed.length===lines.length,receipt.number+' receipt/grouped-line disagreement');total++;if(receipt.fullyCosted)full++;else if(costed.length)partial++;else untouched++;}
 }
 });}
 console.log(JSON.stringify({total,full,partial,untouched,readOnly:true}));
}finally{await pool.end();}}main().catch(e=>{console.error(e);process.exitCode=1;});
