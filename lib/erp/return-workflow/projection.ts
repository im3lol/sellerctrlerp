import {scaled,type ReturnCaseState} from "./model";
export function projectReturnState(state:ReturnCaseState,events:{kind:string;sourceId:string;payload?:Record<string,unknown>}[],operations:{kind:string;payload:Record<string,unknown>;reversedBy?:string|null}[]):ReturnCaseState{
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
 const settled=new Set(active.filter(o=>o.payload.phase==="SETTLEMENT").map(o=>String(o.payload.sourceId)));
 const credits=new Set(active.filter(o=>o.payload.phase==="CREDIT").map(o=>String(o.payload.sourceId)));
 const complete=[...refunds].every(id=>settled.has(id));
 return {...state,financial:complete?"POSTED":credits.size?"PARTIAL":"PENDING",fees:complete?"RECONCILED":"PENDING"};
}
