import {scaled}from "./model";
type Proof={kind:string;sourceId:string;quantity:string|null;payload:Record<string,unknown>};
/** Returns and ledger are alternative views of the same physical goods, never
 * additive stock receipts. Evidence must be newest-first and already SKU-scoped. */
export function physicalReceiptCapacity(proofs:Proof[]){
 const seen=new Set<string>();let returns=BigInt(0),ledger=BigInt(0);
 for(const e of proofs){
  const key=e.kind==="LEDGER"?[e.kind,e.payload.eventDate,e.payload.referenceId,e.payload.sku,e.payload.fulfillmentCenter,e.payload.disposition].join("|"):e.kind+":"+e.sourceId;
  if(seen.has(key))continue;seen.add(key);
  if(e.quantity===null||scaled(e.quantity)<=BigInt(0))continue;
  if(e.kind==="RETURN")returns+=scaled(e.quantity);
  if(e.kind==="LEDGER"&&e.payload.eventType==="CustomerReturns")ledger+=scaled(e.quantity);
 }
 return returns>ledger?returns:ledger;
}
