import {describe,it,expect} from "vitest";
import {returnProducts,isReturnReviewed} from "../products";
import {emptyCaseState} from "../model";
const item={id:"i",code:"P-1",name:"Product",image:"/product.webp"};
const event=(sourceId:string,quantity:string|null,kind="RETURN")=>({kind,sourceId,quantity,payload:{sku:"SKU-1"}});
const aliases=[{itemId:"i",code:"SKU-1"}];
describe("return product presentation",()=>{
 it("keeps partial receipts and open claims out of the reviewed filter",()=>{
  const state=emptyCaseState();
  state.lines=[{id:"l",itemId:"i",invoiceId:"inv",invoiceLineId:"l",deliveryId:null,soldQuantity:"2",expectedQuantity:"2",receivedQuantity:"1",waivedQuantity:"0",writtenOffQuantity:"0"}];
  state.resolutions=[{itemId:"i",action:"SELLABLE",quantity:"1",note:"",at:"2026-11-15"}];
  const products=returnProducts(state,[],[item],[]);
  expect(isReturnReviewed(state,products)).toBe(false);
  state.lines[0].receivedQuantity="2";expect(isReturnReviewed(state,products)).toBe(true);
  state.claims=[{id:"c",lineId:"l",reference:null,reason:"test",state:"REJECTED",expectedAmount:null,acceptedAmount:null,currency:"EGP",evidence:"test"}];
  expect(isReturnReviewed(state,products)).toBe(false);
 });
 it("resolves exact catalog aliases and retains the product image",()=>{
  expect(returnProducts(emptyCaseState(),[event("r","1")],[item],aliases)[0]).toMatchObject({itemId:"i",image:item.image,code:"P-1",quantity:"1"});
 });
 it("adds distinct receipts but does not add alternative refund evidence",()=>{
  const products=returnProducts(emptyCaseState(),[event("a","0.1"),event("b","0.2"),event("f","0.3","REFUND")],[item],aliases);
  expect(products[0].quantity).toBe("0.3");
 });
 it("uses only the latest revision of each source",()=>{
  expect(returnProducts(emptyCaseState(),[event("a","2"),event("a","1")],[item],aliases)[0].quantity).toBe("2");
 });
 it("does not guess a product for an ambiguous alias or a missing quantity",()=>{
  const result=returnProducts(emptyCaseState(),[event("a",null)],[item,{...item,id:"other"}], [...aliases,{itemId:"other",code:"SKU-1"}]);
  expect(result[0]).toMatchObject({itemId:null,quantity:null});
 });
});
