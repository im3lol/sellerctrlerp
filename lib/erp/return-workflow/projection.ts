import {scaled,type ReturnCaseState} from "./model";
type Event={id?:string;kind:string;sourceId:string;payload?:Record<string,unknown>;sourceStatus?:string|null;currency?:string|null};
const financialSignature=(e:Event)=>JSON.stringify([e.currency??"",e.sourceStatus??"",...["total","productSales","shippingCredits","promotionalRebates","sellingFees","fbaFees","otherTransactionFees","other"].map(k=>scaled(String(e.payload?.[k]??"0")).toString())]);
export function projectReturnState(state:ReturnCaseState,events:Event[],operations:{kind:string;payload:Record<string,unknown>;reversedBy?:string|null}[]):ReturnCaseState{
 const removals=new Map<string,Record<string,unknown>>();
 // Callers provide newest-first evidence; older revisions never lower a source cap.
 for(const e of events)if(e.kind==="REMOVAL"&&!removals.has(e.sourceId)&&e.payload)removals.set(e.sourceId,e.payload);
 let sourceInventoryPending=false;
 for(const [sourceId,payload]of removals){
  const dispatched=(state.transfers??[]).filter(t=>t.sourceId===sourceId).reduce((s,t)=>s+scaled(t.dispatched),BigInt(0));
  const disposed=(state.disposals??[]).filter(d=>d.sourceId===sourceId).reduce((s,d)=>s+scaled(d.quantity),BigInt(0));
  if(dispatched!==scaled(String(payload.shippedQty??"0"))||disposed!==scaled(String(payload.disposedQty??"0"))||scaled(String(payload.pendingQty??"0"))>BigInt(0))sourceInventoryPending=true;
 }
 state={...state,sourceInventoryPending};
 const refunds=new Set(events.filter(e=>e.kind==="REFUND").map(e=>e.sourceId));
 if(!refunds.size)return state;
 const active=operations.filter(o=>o.kind==="FINANCIAL"&&!o.reversedBy);
 const latest=new Map<string,Event>();for(const e of events)if(e.kind==="REFUND"&&!latest.has(e.sourceId))latest.set(e.sourceId,e);
 const settled=new Set(active.filter(o=>{
  if(o.payload.phase!=="SETTLEMENT")return false;
  const eventId=o.payload.eventId??(o.payload.decision as {eventId?:string}|undefined)?.eventId;
  const approved=events.find(e=>e.id&&e.id===eventId),current=latest.get(String(o.payload.sourceId));
  return !approved||!current||financialSignature(approved)===financialSignature(current);
 }).map(o=>String(o.payload.sourceId)));
 const credits=new Set(active.filter(o=>o.payload.phase==="CREDIT").map(o=>String(o.payload.sourceId)));
 const complete=[...refunds].every(id=>settled.has(id));
 return {...state,financial:complete?"POSTED":credits.size?"PARTIAL":"PENDING",fees:complete?"RECONCILED":"PENDING"};
}
