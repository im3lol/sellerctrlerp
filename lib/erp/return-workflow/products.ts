import type {ReturnCaseState} from "./model";
import {scaled,decimal} from "./model";
export type ReturnProduct={itemId:string|null;code:string;name:string;image:string|null;quantity:string|null;reason:string|null;sourceCondition:string|null};
type Item={id:string;code:string;name:string|null;image:string|null};
type Event={kind:string;sourceId:string;quantity:string|null;payload:Record<string,unknown>};
export function isReturnReviewed(state:ReturnCaseState,products:ReturnProduct[]):boolean{
 if(!products.length||state.claims.some(c=>!["CLOSED","RECONCILED"].includes(c.state)))return false;
 return products.every(p=>{
  const resolution=state.resolutions?.find(r=>r.itemId===p.itemId);
  if(!p.itemId||!resolution||["WAITING","CLAIM"].includes(resolution.action))return false;
  const lines=state.lines.filter(l=>l.itemId===p.itemId);
  return lines.length>0&&lines.every(l=>l.expectedQuantity!==null&&scaled(l.receivedQuantity)+scaled(l.waivedQuantity)>=scaled(l.expectedQuantity));
 });
}
const normalized=(s:string)=>s.toUpperCase().replace(/[^A-Z0-9]/g,"");
/** Exact aliases only. Refund and receipt quantities are alternative views, not additive. */
export function returnProducts(state:ReturnCaseState,events:Event[],items:Item[],codes:{itemId:string;code:string|null}[]):ReturnProduct[]{
 const aliases=new Map<string,Set<string>>();
 for(const c of [...items.map(i=>({itemId:i.id,code:i.code})),...codes]){const key=normalized(c.code??"");if(!key)continue;const set=aliases.get(key)??new Set();set.add(c.itemId);aliases.set(key,set);}
 const result=new Map<string,ReturnProduct>();const seen=new Set<string>();
 const totals=new Map<string,Map<string,bigint>>();
 for(const event of events){
  const sourceKey=JSON.stringify([event.kind,event.sourceId]);
  if(seen.has(sourceKey))continue;seen.add(sourceKey);
  const code=String(event.payload.sku??event.payload.fnsku??"");if(!code)continue;
  const ids=[...(aliases.get(normalized(code))??[])],item=ids.length===1?items.find(i=>i.id===ids[0]):null;
  const key=item?.id??code;const prev=result.get(key);
  const byKind=totals.get(key)??new Map<string,bigint>();
  if(event.quantity&&scaled(event.quantity)>BigInt(0))byKind.set(event.kind,(byKind.get(event.kind)??BigInt(0))+scaled(event.quantity));
  totals.set(key,byKind);
  const maximum=[...byKind.values()].reduce((a,b)=>a>b?a:b,BigInt(0));
  const quantity=maximum>BigInt(0)?decimal(maximum).replace(/\.?0+$/,""):null;
  result.set(key,{itemId:item?.id??null,code:item?.code??code,name:item?.name??String(event.payload.productName??code),image:item?.image??null,
   quantity,
   reason:prev?.reason??(event.payload.reason?String(event.payload.reason):null),sourceCondition:prev?.sourceCondition??(event.payload.disposition?String(event.payload.disposition):null)});
 }
 for(const line of state.lines){const item=items.find(i=>i.id===line.itemId);if(item&&!result.has(item.id))result.set(item.id,{itemId:item.id,code:item.code,name:item.name??item.code,image:item.image,quantity:line.expectedQuantity,reason:null,sourceCondition:null});}
 return [...result.values()];
}
