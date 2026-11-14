import {beforeAll,afterAll,describe,it,expect,vi}from "vitest";
import {readFileSync}from "node:fs";
import {randomUUID}from "node:crypto";
import {Pool}from "pg";
// This suite calls the session-less import engine, never a legacy posting action.
vi.mock("@/app/actions/erp/sales-returns",()=>({createSalesReturnAction:vi.fn(()=>{throw new Error("Legacy return writer must not run in this suite");})}));

/** Opt-in only: NEVER points at the normal DATABASE_URL or a live tenant. */
const url=process.env.RETURNS_TEST_DATABASE_URL;
if(url&&new URL(url).pathname!=="/sellerctrl_returns_test")throw new Error("Return integration tests require the isolated sellerctrl_returns_test database");
describe.skipIf(!url)("returns PostgreSQL isolation and transaction contract",()=>{
 const pg=new Pool({connectionString:url});
 const org="return-test-"+randomUUID(),other="return-test-"+randomUUID(),platform=randomUUID(),user=randomUUID();
 let store:typeof import("../store"),scope:typeof import("@/lib/db-scope");
 let caseId="";
 beforeAll(async()=>{
  process.env.DATABASE_URL=url!;
  const exists=await pg.query("select to_regclass('public.return_workflow_cases') id");
  if(!exists.rows[0].id)await pg.query("BEGIN;"+readFileSync("db/migrations/0157_return_resolution_workflow.sql","utf8")+"COMMIT;");
  await pg.query("GRANT SELECT,INSERT,UPDATE,DELETE ON return_workflow_settings,return_workflow_cases,return_workflow_events,return_workflow_operations TO appuser");
  await pg.query("insert into organizations(id,name_ar) values($1,'TEST ONLY'),($2,'TEST OTHER')",[org,other]);
  await pg.query("insert into users(id,name,email,password_hash) values($1,'TEST',$2,'not-a-password')",[user,user+"@example.invalid"]);
  await pg.query("insert into sales_platforms(id,organization_id,code,name) values($1,$2,'AMAZON','TEST')",[platform,org]);
  await pg.query("insert into return_workflow_settings(organization_id,mode) values($1,'MONITOR')",[org]);
  store=await import("../store");scope=await import("@/lib/db-scope");
  caseId=(await scope.withOrgScope(org,false,()=>store.observeReturnSource(org,platform,"TEST-ORDER",{kind:"RETURN",sourceId:"test-source-"+org,sourceVersion:"v1",happenedAt:new Date().toISOString(),sourceStatus:"RECEIVED",currency:null,quantity:"2",payload:{sku:"TEST",fulfillment:"FBA"}})))!;
 },30000);
 afterAll(async()=>{await pg.end();if(store){const {pool}=await import("@/lib/db");await pool.end();}});
 const command=(kind:"MATCH"|"FINANCIAL"|"CLAIM",version=1,key=randomUUID())=>({orgId:org,userId:user,caseId,key,version,kind,payload:{evidence:"TEST ONLY"}});
 it("observes evidence without creating a credit, journal or stock movement",async()=>{
  for(const table of ["sales_returns","journal_entries","stock_movements"]){const r=await pg.query(`select count(*) n from ${table} where organization_id=$1`,[org]);expect(Number(r.rows[0].n)).toBe(0);}
 });
 it("blocks financial posting in monitoring before running a writer",async()=>{
  let called=false;await expect(scope.withOrgScope(org,false,()=>store.executeReturnOperation(command("FINANCIAL"),async r=>{called=true;return {state:r.state};}))).rejects.toThrow("observation mode");expect(called).toBe(false);
 });
 it("rolls back nested writes even when the caller catches the exception",async()=>{
  const {db}=await import("@/lib/db"),{returnWorkflowCases}=await import("@/db/schema"),{eq}=await import("drizzle-orm");
  await scope.withOrgScope(org,false,async()=>{try{await store.executeReturnOperation(command("MATCH"),async r=>{
   await db.update(returnWorkflowCases).set({version:77}).where(eq(returnWorkflowCases.id,r.id));throw new Error("injected posting failure");
  });}catch{/* caller keeps its outer transaction alive */}});
  const r=await pg.query("select version from return_workflow_cases where id=$1",[caseId]);expect(r.rows[0].version).toBe(1);
 });
 it("commits one decision for simultaneous retries with one idempotency key",async()=>{
  const cmd=command("MATCH");let calls=0;
  const execute=()=>scope.withOrgScope(org,false,()=>store.executeReturnOperation({...cmd,payload:{...cmd.payload}},async r=>{calls++;return {state:{...r.state,matched:true}};}));
  const r=await Promise.all([execute(),execute()]);expect(calls).toBe(1);expect(r.filter(x=>x.replay)).toHaveLength(1);
  const changed={...cmd,payload:{evidence:"DIFFERENT"}};
  await expect(scope.withOrgScope(org,false,()=>store.executeReturnOperation(changed,async r=>({state:r.state})))).rejects.toThrow("different data");
 });
 it("rejects stale decisions and cross-company access",async()=>{
  await expect(scope.withOrgScope(org,false,()=>store.executeReturnOperation(command("CLAIM"),async r=>({state:r.state})))).rejects.toThrow("changed");
  await expect(scope.withOrgScope(other,false,()=>store.returnCaseDetail(other,caseId))).rejects.toThrow("not found");
 });
 it("keeps source revisions and approved operations immutable",async()=>{
  await expect(pg.query("update return_workflow_events set quantity='999' where case_id=$1",[caseId])).rejects.toThrow("immutable");
  await expect(pg.query("delete from return_workflow_operations where case_id=$1",[caseId])).rejects.toThrow("cannot be deleted");
 });
 it("enforces tenant RLS and rejects a cross-company case foreign key",async()=>{
  const c=await pg.connect();try{
   await c.query("begin; set local role appuser");await c.query("select set_config('app.current_org',$1,true),set_config('app.is_platform_admin','off',true)",[other]);
   const r=await c.query("select id from return_workflow_cases where id=$1",[caseId]);expect(r.rows).toHaveLength(0);
   await c.query("rollback");
   await expect(c.query("insert into return_workflow_events(organization_id,case_id,kind,source_id,source_version,payload) values($1,$2,'LEDGER','bad','v1','{}')",[other,caseId])).rejects.toThrow("foreign key");
  }finally{await c.query("rollback");c.release();}
 });
 it("posts credit, cash and stock independently, and reverses their actual documents",async()=>{
  const {scopeStore}=await import("@/lib/db");
  const {applyReturnFinance}=await import("../finance"),{applyReturnReceipt}=await import("../inventory"),{reverseReturnOperation}=await import("../reverse");
  const {postStockMovement}=await import("@/lib/erp/inventory"),{postEntry}=await import("@/lib/erp/posting");
  const customer=randomUUID(),warehouse=randomUUID(),item=randomUUID(),invoice=randomUUID(),line=randomUUID(),source=randomUUID();
  const date=new Date(),day=date.toISOString().slice(0,10),ids:Record<string,string>={};
  await pg.query("update return_workflow_settings set mode='MANUAL',cutover_at='2000-01-01' where organization_id=$1",[org]);
  await pg.query("insert into customers(id,organization_id,code,name_ar) values($1,$2,'TEST','TEST')",[customer,org]);
  await pg.query("insert into warehouses(id,organization_id,code,name_ar) values($1,$2,'TEST','TEST')",[warehouse,org]);
  await pg.query("insert into items(id,organization_id,code,name_ar) values($1,$2,'TEST','TEST')",[item,org]);
  for(const [code,type]of [["1103","ASSET"],["1104","ASSET"],["1109","ASSET"],["4101","REVENUE"],["4102","REVENUE"],["2102","LIABILITY"],["5101","EXPENSE"],["5301","EXPENSE"],["5211","EXPENSE"],["5203","EXPENSE"],["3002","EQUITY"]]){
   ids[code]=randomUUID();await pg.query("insert into accounts(id,organization_id,code,name_ar,type,is_leaf) values($1,$2,$3,$3,$4,true)",[ids[code],org,code,type]);
  }
  await pg.query("insert into sales_invoices(id,organization_id,number,customer_id,date,status,subtotal,tax_amount,total_amount,paid_amount,balance_due) values($1,$2,'TEST-INV',$3,now(),'PAID',100,14,114,114,0)",[invoice,org,customer]);
  await pg.query("insert into sales_invoice_lines(id,organization_id,sales_invoice_id,item_id,quantity,unit_price,total_amount,tax_amount) values($1,$2,$3,$4,2,50,100,14)",[line,org,invoice,item]);
  await pg.query("insert into marketplace_settlement_txns(id,organization_id,channel,type,order_id,status,currency,total,selling_fees,dedup_key,posted_at) values($1,$2,'AMAZON','Refund','TEST-FIN','Released','EGP',-47,10,$1,now())",[source,org]);
  let originalMovement="";
  await scope.withOrgScope(org,false,async()=>{
   const tx=scopeStore.getStore()!.tx;
   await postStockMovement(tx,{orgId:org,itemId:item,warehouseId:warehouse,type:"IN",quantity:10,unitCost:20,date,referenceType:"TEST_OPEN",referenceId:randomUUID()});
   const out=await postStockMovement(tx,{orgId:org,itemId:item,warehouseId:warehouse,type:"OUT",quantity:2,date,referenceType:"SALES_INVOICE",referenceId:invoice});originalMovement=out.movementId;
   await postEntry(tx,{orgId:org,date,sourceType:"TEST_OPEN",sourceId:randomUUID(),description:"TEST ONLY",userId:user,lines:[{accountId:ids["1104"],debit:200,credit:0},{accountId:ids["3002"],debit:0,credit:200}]});
   await postEntry(tx,{orgId:org,date,sourceType:"TEST_COGS",sourceId:randomUUID(),description:"TEST ONLY",userId:user,lines:[{accountId:ids["5101"],debit:40,credit:0},{accountId:ids["1104"],debit:0,credit:40}]});
  });
  const id=(await scope.withOrgScope(org,false,()=>store.observeReturnSource(org,platform,"TEST-FIN",{kind:"REFUND",sourceId:source,sourceVersion:"v1",happenedAt:date.toISOString(),sourceStatus:"Released",currency:"EGP",quantity:null,payload:{}})))!;
  const event=(await pg.query("select id from return_workflow_events where case_id=$1",[id])).rows[0].id;
  const decision={phase:"CREDIT"as "CREDIT"|"SETTLEMENT",eventId:event,invoiceId:invoice,lineId:line,parts:{principal:"50",discount:"0",tax:"7",shipping:"0"},quantity:"1",date:day,evidence:"TEST verified source",verified:true};
  await scope.withOrgScope(org,false,()=>store.executeReturnOperation({...command("MATCH"),caseId:id},async r=>({state:{...r.state,matched:true,invoiceIds:[invoice],lines:[{id:line,itemId:item,invoiceId:invoice,invoiceLineId:line,deliveryId:null,soldQuantity:"2",expectedQuantity:"1",receivedQuantity:"0",waivedQuantity:"0",writtenOffQuantity:"0"}]}})));
  const finance=(phase:"CREDIT"|"SETTLEMENT",version:number,fail=false)=>scope.withOrgScope(org,false,()=>store.executeReturnOperation({...command("FINANCIAL",version),caseId:id,payload:{sourceId:source,phase,decision:{...decision,phase}}},async(r,operationId)=>{
   const result=await applyReturnFinance(org,user,id,r.state,{...decision,phase},operationId);if(fail)throw new Error("injected after financial posting");return result;
  }));
  await expect(finance("CREDIT",2,true)).rejects.toThrow("injected");
  expect(Number((await pg.query("select balance_due from sales_invoices where id=$1",[invoice])).rows[0].balance_due)).toBe(0);
  await finance("CREDIT",2);
  expect(Number((await pg.query("select balance_due from sales_invoices where id=$1",[invoice])).rows[0].balance_due)).toBe(-57);
  expect(Number((await pg.query("select sum(case when type='IN' then quantity else -quantity end) q from stock_movements where organization_id=$1 and item_id=$2",[org,item])).rows[0].q)).toBe(8);
  await finance("SETTLEMENT",3);
  const inv=(await pg.query("select balance_due,paid_amount,refunded_amount from sales_invoices where id=$1",[invoice])).rows[0];
  expect([Number(inv.balance_due),Number(inv.paid_amount),Number(inv.refunded_amount)]).toEqual([0,114,57]);
  const receipt=await scope.withOrgScope(org,false,()=>store.executeReturnOperation({...command("MATCH",4),kind:"RECEIPT",caseId:id,payload:{movementId:originalMovement,quantity:"1"}},r=>applyReturnReceipt(org,user,id,r.state,{lineId:line,quantity:"1",movementId:originalMovement,warehouseId:warehouse,condition:"SELLABLE",location:"LOCAL",eventIds:[],evidence:"TEST receiving note",date:day})));
  const balance=await scope.withOrgScope(org,false,async()=>{const {currentStock}=await import("@/lib/erp/inventory");return currentStock(org,item,warehouse);});
  expect(balance.quantity).toBe(9);expect(balance.value).toBe(180);
  const journals=await pg.query("select e.id,sum(l.debit-l.credit) delta from journal_entries e join journal_entry_lines l on l.journal_entry_id=e.id where e.organization_id=$1 group by e.id",[org]);
  expect(journals.rows.every(r=>Number(r.delta)===0)).toBe(true);
  await scope.withOrgScope(org,false,()=>store.executeReturnOperation({...command("MATCH",5),kind:"REVERSE",caseId:id,payload:{operationId:receipt.id}},(r,operationId)=>reverseReturnOperation(org,user,id,operationId,receipt.id,day,"TEST receipt reversal")));
  const after=await scope.withOrgScope(org,false,async()=>{const {currentStock}=await import("@/lib/erp/inventory");return currentStock(org,item,warehouse);});
  expect(after.quantity).toBe(8);expect(after.value).toBe(160);
  // Engine effects and source decisions must commit together; imported refund stays untouched.
  expect((await pg.query("select source_status from return_workflow_events where id=$1",[event])).rows[0].source_status).toBe("Released");
  const {applyReturnTransfer}=await import("../transfers"),{applyReturnWriteOff}=await import("../write-offs");
  const transit=randomUUID(),destination=randomUUID(),removal=randomUUID();
  await pg.query("update sales_platforms set default_warehouse_id=$1 where id=$2",[warehouse,platform]);
  await pg.query("insert into warehouses(id,organization_id,code,name_ar) values($1,$3,'TRANSIT','TEST TRANSIT'),($2,$3,'DEST','TEST DEST')",[transit,destination,org]);
  await pg.query("insert into platform_removals(id,organization_id,channel,removal_order_id,order_type,sku,shipped_qty,requested_qty,dedup_key,request_date) values($1,$2,'AMAZON','TEST-REM','Return','TEST',3,3,$1,now())",[removal,org]);
  const removalCase=(await scope.withOrgScope(org,false,()=>store.observeReturnSource(org,platform,'REMOVAL:'+removal,{kind:"REMOVAL",sourceId:removal,sourceVersion:"v1",happenedAt:date.toISOString(),sourceStatus:"Completed",currency:null,quantity:"3",payload:{shippedQty:"3",disposedQty:"0",pendingQty:"0"}})))!;
  const removalEvent=(await pg.query("select id from return_workflow_events where case_id=$1",[removalCase])).rows[0].id;
  const transferDecision={phase:"DISPATCH"as "DISPATCH"|"RECEIVE",eventId:removalEvent,itemId:item,fromWarehouseId:warehouse,transitWarehouseId:transit,destinationWarehouseId:destination,quantity:"3",date:day,evidence:"TEST removal shipment"};
  let transferId="";
  await scope.withOrgScope(org,false,()=>store.executeReturnOperation({...command("MATCH"),kind:"TRANSFER",caseId:removalCase,payload:{...transferDecision,sourceId:removal}},async r=>{const result=await applyReturnTransfer(org,user,removalCase,platform,r.state,transferDecision);transferId=result.transferId;return result;}));
  const receive=(version:number)=>scope.withOrgScope(org,false,()=>store.executeReturnOperation({...command("MATCH",version),kind:"TRANSFER",caseId:removalCase,payload:{...transferDecision,phase:"RECEIVE",quantity:"1",sourceId:removal}},r=>applyReturnTransfer(org,user,removalCase,platform,r.state,{...transferDecision,phase:"RECEIVE",quantity:"1",transferId})));
  await receive(2);
  await scope.withOrgScope(org,false,()=>store.executeReturnOperation({...command("MATCH",3),kind:"WRITE_OFF",caseId:removalCase,payload:{mode:"TRANSIT_LOSS",sourceId:removal,quantity:"1"}},r=>applyReturnWriteOff(org,user,removalCase,platform,r.state,{mode:"TRANSIT_LOSS",transferId,itemId:item,quantity:"1",date:day,evidence:"TEST confirmed transit loss"})));
  await receive(4);
  const stock=(wh:string)=>scope.withOrgScope(org,false,async()=>{const {currentStock}=await import("@/lib/erp/inventory");return currentStock(org,item,wh);});
  expect((await stock(warehouse)).quantity).toBe(5);expect((await stock(transit)).quantity).toBe(0);expect((await stock(destination)).quantity).toBe(2);
  expect((await stock(warehouse)).value+(await stock(destination)).value).toBe(140);
  const detail=await scope.withOrgScope(org,false,()=>store.returnCaseDetail(org,removalCase));
  expect(detail.record.state.transfers?.[0]).toMatchObject({dispatched:"3",received:"2.0000",lost:"1.0000"});
 },120000);
 it("matches reimbursement cash without recognizing the same income twice",async()=>{
  const {scopeStore}=await import("@/lib/db"),{postEntry}=await import("@/lib/erp/posting"),{applyReimbursement}=await import("../reimbursements");
  const source=randomUUID(),walletSource=randomUUID(),income=randomUUID(),claim=randomUUID(),date=new Date();
  await pg.query("insert into accounts(id,organization_id,code,name_ar,type) values($1,$2,'4103','TEST REIMBURSEMENT','REVENUE')",[income,org]);
  const wallet=(await pg.query("select id from accounts where organization_id=$1 and code='1109'",[org])).rows[0].id;
  const jv=await scope.withOrgScope(org,false,()=>postEntry(scopeStore.getStore()!.tx,{orgId:org,date,sourceType:"TEST_RB",sourceId:source,description:"TEST already posted cash",userId:user,lines:[{accountId:wallet,debit:10,credit:0},{accountId:income,debit:0,credit:10}]}));
  await pg.query("insert into fba_reimbursements(id,organization_id,reimbursement_id,currency,amount_total,quantity_reimbursed_cash,approval_date) values($1,$2,$1,'EGP',10,1,now())",[source,org]);
  await pg.query("insert into marketplace_settlement_txns(id,organization_id,type,currency,total,dedup_key,journal_entry_id,status) values($1,$2,'SAFE-T reimbursement','EGP',10,$1,$3,'Released')",[walletSource,org,jv]);
  const id=(await scope.withOrgScope(org,false,()=>store.observeReturnSource(org,platform,"REIMBURSEMENT:"+source,{kind:"REIMBURSEMENT",sourceId:source,sourceVersion:"v1",happenedAt:date.toISOString(),sourceStatus:null,currency:"EGP",quantity:null,payload:{}})))!;
  const event=(await pg.query("select id from return_workflow_events where case_id=$1",[id])).rows[0].id;
  await scope.withOrgScope(org,false,()=>store.executeReturnOperation({...command("MATCH"),caseId:id},r=>Promise.resolve({state:{...r.state,matched:true,claims:[{id:claim,lineId:null,reference:"TEST",reason:"TEST loss",state:"ACCEPTED",expectedAmount:"10",acceptedAmount:"10",expectedQuantity:"0",currency:"EGP",evidence:"TEST ONLY"}]}})));
  const count=Number((await pg.query("select count(*) n from journal_entries where organization_id=$1",[org])).rows[0].n);
  for(const version of [2,3]){
   const decision={mode:"CASH_LINK"as const,eventId:event,claimId:claim,amount:"5",quantity:"0",settlementId:walletSource,date:date.toISOString().slice(0,10),evidence:"TEST wallet match"};
   await scope.withOrgScope(org,false,()=>store.executeReturnOperation({...command("MATCH",version),kind:"REIMBURSEMENT",caseId:id,payload:{...decision,sourceId:source}},r=>applyReimbursement(org,user,id,r.state,decision)));
  }
  expect(Number((await pg.query("select count(*) n from journal_entries where organization_id=$1",[org])).rows[0].n)).toBe(count);
  const detail=await scope.withOrgScope(org,false,()=>store.returnCaseDetail(org,id));
  expect(detail.record.state.claims[0]).toMatchObject({state:"RECONCILED",reconciledCash:"10.0000"});
 },60000);
 it("retains one refund through identifier changes and refuses a stale status downgrade",async()=>{
  const {upsertSettlementTxns}=await import("@/lib/erp/settlement-core"),{toTxnRow,toSettlementTxn}=await import("@/lib/erp/marketplace/amazon/transactions");
  const order="ALIAS-"+randomUUID(),transaction=randomUUID(),refund=randomUUID();
  const deferred={transactionId:transaction,transactionType:"Refund",transactionStatus:"DEFERRED",postedDate:new Date().toISOString(),totalAmount:{currencyAmount:-50,currencyCode:"EGP"},relatedIdentifiers:[{relatedIdentifierName:"ORDER_ID",relatedIdentifierValue:order}]};
  const released={...deferred,transactionId:randomUUID(),transactionStatus:"RELEASED",relatedIdentifiers:[...deferred.relatedIdentifiers,{relatedIdentifierName:"DEFERRED_TRANSACTION_ID",relatedIdentifierValue:transaction},{relatedIdentifierName:"REFUND_ID",relatedIdentifierValue:refund}]};
  const insert=(t:typeof deferred)=>scope.withOrgScope(org,false,()=>upsertSettlementTxns(org,[toSettlementTxn(toTxnRow(t))],"AMAZON"));
  await insert(deferred);await insert(released);await insert(deferred);
  const rows=(await pg.query("select status,source_identifiers from marketplace_settlement_txns where organization_id=$1 and order_id=$2",[org,order])).rows;
  expect(rows).toHaveLength(1);expect(rows[0].status).toBe("Released");expect(rows[0].source_identifiers).toEqual(expect.arrayContaining([{relatedIdentifierName:"REFUND_ID",relatedIdentifierValue:refund}]));
 },30000);
});
