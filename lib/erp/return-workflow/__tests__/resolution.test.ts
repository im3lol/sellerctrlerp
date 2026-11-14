import {describe,it,expect}from "vitest";
import {emptyCaseState,caseClosure,scaled,decimal,refundAmount,assertReceiptCapacity,type ReturnCaseLine}from "../model";
import {refundReconciliation,allocationFingerprint}from "../finance-math";
import {projectReturnState}from "../projection";
import {physicalReceiptCapacity}from "../physical-proof";
import {originalReceiptCost}from "../original-cost";
const line=(over:Partial<ReturnCaseLine>={}):ReturnCaseLine=>({id:"l",itemId:"i",invoiceId:"s",invoiceLineId:"l",deliveryId:"d",soldQuantity:"2",expectedQuantity:"2",receivedQuantity:"0",waivedQuantity:"0",writtenOffQuantity:"0",...over});
describe("independent return resolution",()=>{
 it("does not add the ledger and return report for the same physical quantity",()=>{
  const r={kind:"RETURN",sourceId:"r",quantity:"1",payload:{}};
  const ledger={kind:"LEDGER",sourceId:"l",quantity:"1",payload:{eventType:"CustomerReturns",sku:"X",referenceId:"O",eventDate:"2026-11-15",fulfillmentCenter:"FC",disposition:"SELLABLE"}};
  expect(physicalReceiptCapacity([r,ledger])).toBe(scaled("1"));
  expect(physicalReceiptCapacity([{...ledger,sourceId:"revised",quantity:"2"},ledger])).toBe(scaled("2"));
  expect(physicalReceiptCapacity([{...r,sourceId:"another"},r,ledger])).toBe(scaled("2"));
 });
 it("does not infer a receipt or quantity from a refund",()=>{
  const s={...emptyCaseState("FBA"),matched:true,financial:"POSTED"as const,fees:"RECONCILED"as const,lines:[line({expectedQuantity:null})]};
  expect(caseClosure(s)).toMatchObject({financialClosed:true,inventoryClosed:false,closed:false});
 });
 it("keeps a partial physical receipt open until all units are evidenced",()=>{
  const s={...emptyCaseState(),matched:true,financial:"POSTED"as const,fees:"RECONCILED"as const,lines:[line({receivedQuantity:"1"})]};
  expect(caseClosure(s).closed).toBe(false);s.lines[0].receivedQuantity="2";expect(caseClosure(s).closed).toBe(true);
 });
 it("allows documented returnless quantity without inventing a stock movement",()=>{
  const s={...emptyCaseState(),matched:true,financial:"POSTED"as const,fees:"RECONCILED"as const,lines:[line({waivedQuantity:"2"})]};
  expect(caseClosure(s).closed).toBe(true);expect(s.lines[0].receivedQuantity).toBe("0");
 });
 it("never closes an outstanding claim even after refund and goods receipt",()=>{
  const s={...emptyCaseState(),matched:true,financial:"POSTED"as const,fees:"RECONCILED"as const,lines:[line({receivedQuantity:"2"})],claims:[{id:"c",lineId:"l",reference:null,reason:"missing",state:"REJECTED"as const,expectedAmount:"50",acceptedAmount:null,currency:"EGP",evidence:"proof"}]};
  expect(caseClosure(s).claimsClosed).toBe(false);
 });
 it("retains dispatched goods in transit until receipt or explicit loss",()=>{
  const s={...emptyCaseState(),matched:true,financial:"EXEMPT"as const,fees:"EXEMPT"as const,transfers:[{id:"t",itemId:"i",fromWarehouseId:"a",transitWarehouseId:"b",destinationWarehouseId:"c",dispatched:"5",received:"3",lost:"1",value:"100",sourceId:"r"}]};
  expect(caseClosure(s).inventoryClosed).toBe(false);s.transfers[0].lost="2";expect(caseClosure(s).closed).toBe(true);
 });
 it("rejects unknown, zero, negative and excessive receipt quantities",()=>{
  for(const q of ["0","-1","2.0001"])expect(()=>assertReceiptCapacity(line(),q)).toThrow();
  expect(()=>assertReceiptCapacity(line({expectedQuantity:null}),"1")).toThrow();
  expect(()=>assertReceiptCapacity(line({receivedQuantity:"1",waivedQuantity:"0.5"}),"0.5001")).toThrow();
  expect(()=>assertReceiptCapacity(line({receivedQuantity:"1",waivedQuantity:"0.5"}),"0.5")).not.toThrow();
 });
 it("requires every refund source to settle and ignores reversed approvals",()=>{
  const events=[{kind:"REFUND",sourceId:"a"},{kind:"REFUND",sourceId:"a"},{kind:"REFUND",sourceId:"b"}];
  const operations=[{kind:"FINANCIAL",payload:{sourceId:"a",phase:"CREDIT"}},{kind:"FINANCIAL",payload:{sourceId:"a",phase:"SETTLEMENT"}}];
  expect(projectReturnState(emptyCaseState(),events,operations).financial).toBe("PARTIAL");
  const both=[...operations,{kind:"FINANCIAL",payload:{sourceId:"b",phase:"CREDIT"}},{kind:"FINANCIAL",payload:{sourceId:"b",phase:"SETTLEMENT"}}];
  expect(projectReturnState(emptyCaseState(),events,both).financial).toBe("POSTED");
  expect(projectReturnState(emptyCaseState(),events,[...both.slice(0,-1),{...both.at(-1)!,reversedBy:"r"}]).financial).toBe("PARTIAL");
 });
});
describe("refund accounting precision",()=>{
 it("holds indivisible partial cost rather than reversing 9.99 from an original 10.00",()=>{
  expect(()=>originalReceiptCost("10","3","1")).toThrow("rounding-allocation");
  expect(originalReceiptCost("10","3","3").value).toBe(10);
  expect(originalReceiptCost("40","2","1")).toMatchObject({unitCost:20,value:20});
  expect(originalReceiptCost("0","2","1").value).toBe(0);
 });
 it("compares JSONB decisions by value instead of object key order",()=>{
  expect(allocationFingerprint([{invoiceId:"i",lineId:"l",quantity:"1",parts:{principal:"100",discount:"0",tax:"14",shipping:"0"}}]))
   .toBe(allocationFingerprint([{lineId:"l",invoiceId:"i",parts:{shipping:"0.0000",tax:"14.0000",discount:"0.0000",principal:"100.0000"},quantity:"1.0000"}]));
 });
 it("does not close partially allocated removal sources",()=>{
  const s={...emptyCaseState(),matched:true,financial:"EXEMPT"as const,fees:"EXEMPT"as const,inventoryExemptReason:"test"};
  const p=projectReturnState(s,[{kind:"REMOVAL",sourceId:"x",payload:{shippedQty:"2",pendingQty:"1"}}],[]);
  expect(caseClosure(p).closed).toBe(false);expect(p.sourceInventoryPending).toBe(true);
 });
 it("separates customer principal/discount/tax/shipping from fee refunds",()=>{
  const parts={principal:"100",discount:"10",tax:"12.60",shipping:"5"};
  expect(refundAmount(parts)).toBe("107.6000");
  expect(refundReconciliation(parts,"-92.6",["20","-5","0"])).toMatchObject({customer:"107.6000",returnedFees:"15.0000"});
  expect(()=>refundReconciliation(parts,"-107.60",["20","-5","0"])).toThrow();
 });
 it("rejects impossible component allocations",()=>{
  expect(()=>refundAmount({principal:"1",discount:"2",tax:"5",shipping:"0"})).toThrow();
  expect(()=>refundAmount({principal:"-1",discount:"0",tax:"0",shipping:"0"})).toThrow();
 });
 it("preserves decimal quantities and prevents silent precision loss",()=>{
  expect(decimal(scaled("0.1")+scaled("0.2"))).toBe("0.3000");expect(()=>scaled("0.00001")).toThrow();
  expect(decimal(scaled("99999999999999.9999"))).toBe("99999999999999.9999");
 });
});
