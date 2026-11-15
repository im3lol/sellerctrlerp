type Ident={relatedIdentifierName?:string;relatedIdentifierValue?:string};
export function refundAliases(transactionId:string|null|undefined,identifiers:Ident[]|null|undefined){
 const values=new Set<string>();if(transactionId)values.add("T:"+transactionId);
 for(const id of identifiers??[]){
  if(!id.relatedIdentifierValue)continue;
  if(id.relatedIdentifierName==="REFUND_ID")values.add("R:"+id.relatedIdentifierValue);
  if(["DEFERRED_TRANSACTION_ID","SELLERCTRL_OBSERVED_TRANSACTION_ID"].includes(id.relatedIdentifierName??""))values.add("T:"+id.relatedIdentifierValue);
 }
 return values;
}
